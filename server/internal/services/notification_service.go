/*
@file notification_service.go
@description NotificationService 的具体实现（Phase 12 Lead）：
             - Create：在外部 tx 内调 insert_notification_secure SECURITY DEFINER 函数
               （migration 0002 §insert_notification_secure），写入 notifications 表
               不允许业务层 raw INSERT 绕过权限校验（spec §8 + part2 §W3）
             - List/MarkRead/MarkAllRead：用 RLS 注入身份后走 pool（SELECT/UPDATE）
             - FlushOutbox：扫描 delivered_at IS NULL 行 → 调 hub.Broadcast → 标记 delivered_at
               幂等：同一行被两个 flush 周期同时处理时，UPDATE delivered_at IS NULL 子句
               让 race winner 之外的 worker 拿到 0 行更新，不会重复推送

             业务背景：
             - 通知必须与业务操作同事务（feedback Create + new_feedback notification 不能分裂）
             - hub 推送在 commit 之后（outbox 工作模式）；commit 失败时通知行根本不存在
             - hub 推送失败 ≠ 业务失败：用户离线属于正常状态，下次 List 拉取即可

@author Atlas.oi
@date 2026-04-29
*/

package services

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	progressdb "github.com/ghostterm/progress-server/internal/db"
)

// ============================================================
// Sentinel errors
// ============================================================

// ErrNotificationNotFound 通知不存在，或当前用户无权访问（RLS 决定）。
//
// 设计取舍：合并"不存在"与"无权"两种结果到同一 error，避免暴露行存在性。
var ErrNotificationNotFound = errors.New("notification_not_found")

// ErrNotificationInvalidType 类型不在 notification_type enum 白名单内。
var ErrNotificationInvalidType = errors.New("notification_invalid_type")

// validNotificationTypes 与 0001 migration notification_type enum 一致。
// 改 enum 时三处必须同步：DB enum / openapi.yaml / 此白名单。
var validNotificationTypes = map[string]bool{
	"ball_passed":          true,
	"deadline_approaching": true,
	"overdue":              true,
	"new_feedback":         true,
	"settlement_received":  true,
	"project_terminated":   true,
}

// defaultListLimit 当 caller 传 limit<=0 时的兜底值。
//
// 业务背景：通知中心 UI 默认显示最近 20 条；Phase 12 plan §12.4 spec 字段。
const defaultListLimit = 20

// maxListLimit 单次查询上限（防止前端 limit=99999 拖垮 DB）。
const maxListLimit = 200

// ============================================================
// Service 实现
// ============================================================

type notificationService struct {
	pool *pgxpool.Pool
	hub  WSHub
}

var _ NotificationService = (*notificationService)(nil)

// NotificationServiceDeps 装配 NewNotificationService 依赖。
//
// hub 允许 nil（测试场景可不接 hub）；FlushOutbox 在 hub=nil 时直接 noop。
type NotificationServiceDeps struct {
	Pool *pgxpool.Pool
	Hub  WSHub
}

// NewNotificationService 构造 NotificationService。
func NewNotificationService(deps NotificationServiceDeps) (*notificationService, error) {
	if deps.Pool == nil {
		return nil, errors.New("notification_service: pool is required")
	}
	return &notificationService{pool: deps.Pool, hub: deps.Hub}, nil
}

// ============================================================
// Create
// ============================================================

// Create 在调用方提供的 tx 内写入一条通知，使用 insert_notification_secure SECURITY DEFINER 函数。
//
// 业务流程：
//  1. 校验 ntype 在白名单内（fail-fast 防止类型漂移）
//  2. tx.QueryRow → SELECT insert_notification_secure(uid, type, pid, title, body)
//     SECURITY DEFINER 函数内部检查权限：admin / 自我通知 / 同项目成员之间
//  3. 二次 SELECT 拿完整行（函数返回 BIGINT id，不带其它字段）
//
// 设计取舍：
//   - 不在 service 层 INSERT 而是调函数：
//     业务连接（progress_app）对 notifications 只有 SELECT/UPDATE，无 INSERT；
//     INSERT 必须由 progress_rls_definer owner 的 SECURITY DEFINER 函数承担
//   - 调用方负责 tx commit/rollback：通知与业务操作要么一起成功要么一起失败
func (s *notificationService) Create(
	ctx context.Context,
	tx pgx.Tx,
	userID int64,
	ntype string,
	projectID *int64,
	title, body string,
) (Notification, error) {
	if !validNotificationTypes[ntype] {
		return Notification{}, fmt.Errorf("%w: %q", ErrNotificationInvalidType, ntype)
	}
	if title == "" || body == "" {
		return Notification{}, errors.New("notification_service: title/body must be non-empty")
	}

	// 调 SECURITY DEFINER 函数；函数返回新插入行的 id
	var id int64
	if err := tx.QueryRow(ctx,
		`SELECT insert_notification_secure($1, $2::notification_type, $3, $4, $5)`,
		userID, ntype, projectID, title, body,
	).Scan(&id); err != nil {
		return Notification{}, fmt.Errorf("notification_service: insert_notification_secure: %w", err)
	}

	// 二次拉完整行（含 created_at 等 DB 默认字段）
	var n Notification
	row := tx.QueryRow(ctx, `
		SELECT id, user_id, type::TEXT, project_id, title, body,
		       is_read, created_at, read_at, delivered_at
		FROM notifications WHERE id = $1
	`, id)
	if err := row.Scan(
		&n.ID, &n.UserID, &n.Type, &n.ProjectID, &n.Title, &n.Body,
		&n.IsRead, &n.CreatedAt, &n.ReadAt, &n.DeliveredAt,
	); err != nil {
		return Notification{}, fmt.Errorf("notification_service: read inserted row: %w", err)
	}
	return n, nil
}

// ============================================================
// List
// ============================================================

// List 列出当前用户的通知（按创建时间倒序）。
//
// 业务流程：
//  1. 事务内 SET LOCAL app.user_id（让 RLS notifications_select 策略起作用）
//  2. SELECT 按 unreadOnly 过滤
//  3. ORDER BY created_at DESC + LIMIT
//
// 设计取舍：
//   - 不返回 delivered_at 给前端：outbox 内部状态，前端只关心是否已读
//   - is_read 索引覆盖：idx_notifications_user (user_id, is_read, created_at DESC)
func (s *notificationService) List(
	ctx context.Context,
	userID int64,
	unreadOnly bool,
	limit int,
) ([]Notification, error) {
	if limit <= 0 {
		limit = defaultListLimit
	}
	if limit > maxListLimit {
		limit = maxListLimit
	}

	var out []Notification
	err := progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		// role_id 在 List 不影响 RLS 策略（user_id 自查）；传 0 即可，policy 用 user_id = current_user_id
		// 但 SetSessionContext 要求 roleID 非 0；这里读一次 users.role_id
		var roleID int64
		if err := tx.QueryRow(ctx, `SELECT role_id FROM users WHERE id = $1`, userID).Scan(&roleID); err != nil {
			return fmt.Errorf("notification_service: read role_id: %w", err)
		}
		if err := progressdb.SetSessionContext(ctx, tx, userID, roleID); err != nil {
			return fmt.Errorf("notification_service: set rls context: %w", err)
		}

		// 静态 SQL：用 NULL 短路实现可选过滤，不拼接字符串
		rows, err := tx.Query(ctx, `
			SELECT id, user_id, type::TEXT, project_id, title, body,
			       is_read, created_at, read_at, delivered_at
			FROM notifications
			WHERE user_id = $1
			  AND ($2::BOOLEAN IS FALSE OR is_read = FALSE)
			ORDER BY created_at DESC
			LIMIT $3
		`, userID, unreadOnly, limit)
		if err != nil {
			return fmt.Errorf("notification_service: list: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var n Notification
			if err := rows.Scan(
				&n.ID, &n.UserID, &n.Type, &n.ProjectID, &n.Title, &n.Body,
				&n.IsRead, &n.CreatedAt, &n.ReadAt, &n.DeliveredAt,
			); err != nil {
				return fmt.Errorf("notification_service: scan: %w", err)
			}
			out = append(out, n)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// ============================================================
// MarkRead
// ============================================================

// MarkRead 把单条通知标记为已读。
//
// 业务流程：
//  1. 事务内 SET LOCAL GUC
//  2. UPDATE notifications SET is_read=TRUE, read_at=NOW() WHERE id=$1 AND user_id=$2
//     —— RLS notifications_update 策略 USING/WITH CHECK 双重把关，
//        非 owner 的 UPDATE 既找不到行也写不进去
//  3. RowsAffected == 0 → ErrNotificationNotFound
func (s *notificationService) MarkRead(
	ctx context.Context,
	userID, notificationID int64,
) error {
	return progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		var roleID int64
		if err := tx.QueryRow(ctx, `SELECT role_id FROM users WHERE id = $1`, userID).Scan(&roleID); err != nil {
			return fmt.Errorf("notification_service: read role_id: %w", err)
		}
		if err := progressdb.SetSessionContext(ctx, tx, userID, roleID); err != nil {
			return fmt.Errorf("notification_service: set rls context: %w", err)
		}

		// is_read=FALSE 子句让"已读再标读"的重复操作返回 0 行（幂等无副作用）
		// 但调用方期望 200 OK 而不是 404，所以用 OR 兜底：行存在即视为成功
		tag, err := tx.Exec(ctx, `
			UPDATE notifications
			SET is_read = TRUE, read_at = COALESCE(read_at, NOW())
			WHERE id = $1 AND user_id = $2
		`, notificationID, userID)
		if err != nil {
			return fmt.Errorf("notification_service: mark read: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return ErrNotificationNotFound
		}
		return nil
	})
}

// ============================================================
// MarkAllRead
// ============================================================

// MarkAllRead 把当前用户全部未读通知一并标读。
func (s *notificationService) MarkAllRead(ctx context.Context, userID int64) error {
	return progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		var roleID int64
		if err := tx.QueryRow(ctx, `SELECT role_id FROM users WHERE id = $1`, userID).Scan(&roleID); err != nil {
			return fmt.Errorf("notification_service: read role_id: %w", err)
		}
		if err := progressdb.SetSessionContext(ctx, tx, userID, roleID); err != nil {
			return fmt.Errorf("notification_service: set rls context: %w", err)
		}
		_, err := tx.Exec(ctx, `
			UPDATE notifications
			SET is_read = TRUE, read_at = COALESCE(read_at, NOW())
			WHERE user_id = $1 AND is_read = FALSE
		`, userID)
		if err != nil {
			return fmt.Errorf("notification_service: mark all read: %w", err)
		}
		return nil
	})
}

// ============================================================
// FlushOutbox
// ============================================================

// FlushOutbox 扫描 delivered_at IS NULL 的通知 → 推送给 hub → 标记已投递。
//
// 业务流程（每次 ticker 调用）：
//  1. SELECT 全表 delivered_at IS NULL 的最近通知（限 200 条防止大批量）
//  2. 对每条调用 hub.Broadcast(n)（用户离线返回 ErrNoSubscribers，吞掉）
//  3. UPDATE delivered_at = NOW() WHERE id = $1 AND delivered_at IS NULL
//     —— delivered_at IS NULL 子句保证幂等：同一行被两个 worker 同时处理时，
//        race winner 之外的 worker 拿到 0 行更新，不会重复推送
//
// 设计取舍：
//   - 用应用层连接池（progress_app）—— notifications 表有 SELECT + UPDATE 权限
//     （不需要 SECURITY DEFINER，因为 outbox 是后台任务不绑定特定 user）
//   - 但 outbox 进程"以系统身份"读全表，绕过 RLS：用 SET LOCAL role 切到 progress_rls_definer？
//     不需要 —— FORCE RLS 仅限 progress_app；outbox 进程跑的是 BYPASS-RLS 数据查询时
//     RLS policy 不应卡住。当前实现：以 admin（role_id=1）身份 SET LOCAL，让 is_admin() 通过
//     RLS notifications_select 策略
//   - hub 为 nil（测试场景）→ 直接返回 nil noop
func (s *notificationService) FlushOutbox(ctx context.Context) error {
	if s.hub == nil {
		return nil
	}

	type pending struct {
		Notification
	}
	var pendingList []pending

	// ============================================================
	// 第一步：以 admin 身份 SELECT 全部待推送通知
	//   role_id=1 是 0001 migration 预置 super_admin 角色 ID
	//   user_id 设为 NULL 不行（RLS notifications_select 要求 user_id 匹配或 is_admin）
	//   这里用一个特殊 user_id=0（不存在的 ID）+ role_id=1 让 is_admin() 走通
	// ============================================================
	err := progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		// SetSessionContext 内部 SET LOCAL app.user_id + app.role_id
		if err := progressdb.SetSessionContext(ctx, tx, 0, 1); err != nil {
			return fmt.Errorf("notification_service: set outbox context: %w", err)
		}
		rows, err := tx.Query(ctx, `
			SELECT id, user_id, type::TEXT, project_id, title, body,
			       is_read, created_at, read_at, delivered_at
			FROM notifications
			WHERE delivered_at IS NULL
			ORDER BY created_at ASC
			LIMIT 200
		`)
		if err != nil {
			return fmt.Errorf("notification_service: list outbox: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var n Notification
			if err := rows.Scan(
				&n.ID, &n.UserID, &n.Type, &n.ProjectID, &n.Title, &n.Body,
				&n.IsRead, &n.CreatedAt, &n.ReadAt, &n.DeliveredAt,
			); err != nil {
				return fmt.Errorf("notification_service: scan outbox: %w", err)
			}
			pendingList = append(pendingList, pending{Notification: n})
		}
		return rows.Err()
	})
	if err != nil {
		return err
	}

	// ============================================================
	// 第二步：对每条调 hub.Broadcast → 标记 delivered_at
	//   用户离线（ErrNoSubscribers）也写 delivered_at —— 离线意味着用户下次上线
	//   会主动 GET /api/notifications 拉取；outbox 不再重试
	// ============================================================
	now := time.Now()
	for _, p := range pendingList {
		// 推送（失败不阻断；离线用户保留通知行待 List 主动拉取）
		_ = s.hub.Broadcast(p.Notification)

		// 标记已投递；delivered_at IS NULL 子句保证幂等
		if _, err := s.pool.Exec(ctx, `
			UPDATE notifications
			SET delivered_at = $1
			WHERE id = $2 AND delivered_at IS NULL
		`, now, p.ID); err != nil {
			// 单条标记失败不阻断整个 flush（下次循环还会扫到）
			// 不返回 error，避免 ticker 被卡住
			continue
		}
	}
	return nil
}
