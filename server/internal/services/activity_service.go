// @file activity_service.go
// @description 进度时间线聚合 service —— 读取 project_activity_view + 游标分页 + RLS 上下文注入
//
// 业务流程：
//  1. SessionContext type-assert 为 AuthContext（失败 → ErrInvalidSessionContext）
//  2. limit clamp 到 [1, 100]，0/负数走默认 50
//  3. cursor decode（base64url JSON）；非法格式立即返回 ErrInvalidCursor
//  4. 进 InTx，第一行 SET LOCAL ROLE progress_app + SetSessionContext 注入 RLS GUC
//     —— SET LOCAL ROLE 让 dockertest 用的 postgres 超级用户也走 NOBYPASSRLS 路径，
//     与生产 progress_app 直连行为一致；本身在生产是幂等 no-op
//  5. SELECT EXISTS(projects WHERE id=$1) 做存在性 + 可见性双重 guard
//     RLS 屏蔽掉非成员可见的项目 → exists=false → 返回 ErrActivityProjectNotFound
//  6. 主查询 project_activity_view + LEFT JOIN users(display_name) + roles(name)
//     拿 actor 名/角色（VIEW 只携带 actor_id，name 从应用层 JOIN 拿）
//  7. 取 limit+1 行；超出则切片末位生成 nextCursor，items 截回 limit
//
// 设计取舍：
//   - 排序键三元组 (occurred_at DESC, kind DESC, source_id DESC) 与 cursor decode 严格对齐
//   - VIEW 已 UNION 全 7 表，service 不区分 kind —— 任何新事件类型只需在 VIEW 加 UNION
//
// @author Atlas.oi
// @date 2026-05-01

package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	progressdb "github.com/ghostterm/progress-server/internal/db"
)

// ErrActivityProjectNotFound 表示项目不存在或调用者无权访问（RLS 隐性屏蔽）。
//
// 业务背景：Spec 锁定决策 "RLS gives 0 rows; SELECT EXISTS catches and returns sentinel"。
// handler 层把此 sentinel 映射为 404，避免泄露"项目存在但你看不见"信号。
var ErrActivityProjectNotFound = errors.New("services: activity project not found or forbidden")

// ActivityView 是 service 层的活动视图模型（与 OAS Activity 1:1 映射，handler 层做转换）。
type ActivityView struct {
	ID            string // "{kind}:{sourceID}"，前端去重使用
	SourceID      int64
	ProjectID     int64
	Kind          string
	OccurredAt    time.Time
	ActorID       int64
	ActorName     *string // users.display_name；JOIN 缺行时 NULL（actor 用户被删）
	ActorRoleName *string // roles.name；同上
	Payload       json.RawMessage
}

// ListActivitiesResult 是 List 的返回值。
type ListActivitiesResult struct {
	Items      []ActivityView
	NextCursor *string // 仅当 DB 返回 > limit 行时填充；caller 据此判定是否还有下一页
}

// ActivityService 是 service 层接口。
type ActivityService interface {
	List(ctx context.Context, sc SessionContext, projectID int64, limit int, beforeCursor string) (ListActivitiesResult, error)
}

type activityService struct {
	pool *pgxpool.Pool
}

// 编译时校验：activityService 必须满足 ActivityService interface
var _ ActivityService = (*activityService)(nil)

// NewActivityService 构造 ActivityService 实现。
func NewActivityService(pool *pgxpool.Pool) ActivityService {
	return &activityService{pool: pool}
}

// List 返回项目的进度时间线（按 occurred_at DESC, kind DESC, source_id DESC）。
func (s *activityService) List(
	ctx context.Context,
	sc SessionContext,
	projectID int64,
	limit int,
	beforeCursor string,
) (ListActivitiesResult, error) {
	ac, ok := sc.(AuthContext)
	if !ok {
		return ListActivitiesResult{}, ErrInvalidSessionContext
	}

	// limit clamp：0/负数 → 50（默认页大小）；> 100 → 100（防爆表）
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}

	cursor, err := decodeCursor(beforeCursor)
	if err != nil {
		return ListActivitiesResult{}, err
	}

	var out ListActivitiesResult

	err = progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		// SET LOCAL ROLE progress_app：让 RLS 在测试 / 超级用户连接下也强制生效；
		// 生产侧本来就以 progress_app 身份连接，此 SET 是幂等 no-op
		if _, err := tx.Exec(ctx, `SET LOCAL ROLE progress_app`); err != nil {
			return fmt.Errorf("activity_service: set role progress_app: %w", err)
		}
		if err := progressdb.SetSessionContext(ctx, tx, ac.UserID, ac.RoleID); err != nil {
			return fmt.Errorf("activity_service: set rls context: %w", err)
		}

		// 项目存在性 + 可见性 guard：RLS 自动屏蔽非成员可见的项目，
		// SELECT EXISTS 既验证 (a) 行存在 (b) 当前 GUC 身份能看到。
		var exists bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM projects WHERE id = $1)
		`, projectID).Scan(&exists); err != nil {
			return fmt.Errorf("activity_service: membership guard: %w", err)
		}
		if !exists {
			return ErrActivityProjectNotFound
		}

		// 游标 WHERE：仅在 caller 显式传 cursor 时附加（首页查询不带）
		args := []any{projectID, limit + 1}
		whereCursor := ""
		if beforeCursor != "" {
			args = append(args, cursor.At, cursor.Kind, cursor.SourceID)
			whereCursor = `
				AND (
					av.occurred_at < $3
					OR (av.occurred_at = $3 AND av.kind < $4)
					OR (av.occurred_at = $3 AND av.kind = $4 AND av.source_id < $5)
				)
			`
		}

		// VIEW 不携带 actor 名/角色，应用层 LEFT JOIN users + roles
		// 注：users 表字段是 display_name，不是 name；migration 0001 §75
		sqlStr := `
			SELECT
				(av.kind || ':' || av.source_id::text) AS id,
				av.source_id,
				av.project_id,
				av.kind,
				av.occurred_at,
				av.actor_id,
				u.display_name AS actor_name,
				r.name AS actor_role_name,
				av.payload
			FROM project_activity_view av
			LEFT JOIN users u ON u.id = av.actor_id
			LEFT JOIN roles r ON r.id = u.role_id
			WHERE av.project_id = $1` + whereCursor + `
			ORDER BY av.occurred_at DESC, av.kind DESC, av.source_id DESC
			LIMIT $2
		`

		rows, err := tx.Query(ctx, sqlStr, args...)
		if err != nil {
			return fmt.Errorf("activity_service: query: %w", err)
		}
		defer rows.Close()

		items := make([]ActivityView, 0, limit+1)
		for rows.Next() {
			var a ActivityView
			if err := rows.Scan(
				&a.ID, &a.SourceID, &a.ProjectID, &a.Kind,
				&a.OccurredAt, &a.ActorID, &a.ActorName, &a.ActorRoleName, &a.Payload,
			); err != nil {
				return fmt.Errorf("activity_service: scan: %w", err)
			}
			items = append(items, a)
		}
		if err := rows.Err(); err != nil {
			return fmt.Errorf("activity_service: iterate: %w", err)
		}

		// 取出 limit+1 行：超出 limit 即视为还有下一页，用第 limit 个（idx limit-1）
		// 行的三元组生成 cursor。这样 caller 用此 cursor 拉下一页时严格不重不漏。
		if len(items) > limit {
			last := items[limit-1]
			next, err := encodeCursor(activityCursor{
				At:       last.OccurredAt,
				Kind:     last.Kind,
				SourceID: last.SourceID,
			})
			if err != nil {
				return fmt.Errorf("activity_service: encode next cursor: %w", err)
			}
			out.NextCursor = &next
			items = items[:limit]
		}

		out.Items = items
		return nil
	})

	if err != nil {
		return ListActivitiesResult{}, err
	}
	return out, nil
}
