/*
@file feedback_service.go
@description FeedbackService 的具体实现（Phase 7 Worker D）：
             - List：按 project_id 列出反馈，按 recorded_at ASC 排序（spec §4 反馈是时间顺序流水）
             - Create：事务内 INSERT feedbacks (+ 可选 feedback_attachments)，
               同事务 SET LOCAL app.user_id/role_id 让 RLS 策略 feedbacks_all 验证调用者是项目成员
             - UpdateStatus：仅允许 status 字段单字段更新（pending → done / done → pending）

             业务背景（spec §4 + 0001/0002 migration）：
             - 反馈 source 默认 'wechat'（DB DEFAULT），调用方未传时由 DB 兜底
             - 反馈 status 默认 'pending'（DB DEFAULT），创建后需要负责人主动 mark done
             - feedbacks RLS = is_member(project_id)；通过 SetSessionContext 注入 GUC，
               非成员调用方在 INSERT/SELECT 时 RLS 直接拦下，service 不做应用层 ID 过滤
             - feedback_attachments 关联文件：通过 attachment_ids 在同事务 INSERT，
               INSERT 顺序保证：feedbacks RETURNING id 之后再 INSERT attachments

             v2 part2 §W3 通知 outbox：
             - 完整版本应同事务 INSERT notifications (type=new_feedback) 给 project.created_by；
               但 NotificationService 由 Phase 12 实现，本 Phase 不依赖通知服务，
               预留扩展位（Create 函数注释中说明），不做静默通知降级

             SessionContext 类型契约：
             - 与 AuthService / RBACService 一致，sc 必须是 services.AuthContext；
               不是则返回 error（fail-fast，避免静默匿名写入）
@author Atlas.oi
@date 2026-04-29
*/

package services

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	progressdb "github.com/ghostterm/progress-server/internal/db"
)

// ============================================================
// Sentinel errors
// ============================================================

// ErrFeedbackNotFound 反馈不存在或当前会话无权访问（RLS 决定）。
//
// 设计取舍：合并"不存在"与"无权"两种结果到同一 error，避免暴露行存在性
// 给非成员探测 project_id 范围。
var ErrFeedbackNotFound = errors.New("feedback_not_found")

// ErrFeedbackContentEmpty 反馈 content 字段为空字符串或仅含空白。
//
// content TEXT NOT NULL（DB 约束）+ application 层补 trim 后判空，
// 让 422 错误消息精确 "content 必填" 而不是 PG 报错的 "value too long" 之类。
var ErrFeedbackContentEmpty = errors.New("feedback_content_empty")

// ErrFeedbackInvalidStatus 反馈 status 不在 {pending, done} 枚举内。
var ErrFeedbackInvalidStatus = errors.New("feedback_invalid_status")

// ErrFeedbackInvalidSource 反馈 source 不在 {phone, wechat, email, meeting, other} 枚举内。
var ErrFeedbackInvalidSource = errors.New("feedback_invalid_source")

// ============================================================
// 数据视图模型
// ============================================================

// Feedback 是 service 层返回给 handler 的反馈视图（与 oas.Feedback 字段对齐）。
//
// 业务背景：避免 services 包反向依赖 oas 包；handler 层做 service.Feedback → oas.Feedback 转换。
type Feedback struct {
	ID            int64
	ProjectID     int64
	Content       string
	Source        string
	Status        string
	RecordedBy    int64
	RecordedAt    time.Time
	AttachmentIDs []int64
}

// CreateFeedbackInput 是 Create 接受的领域级输入参数。
//
// 字段含义：
//   - Content：反馈正文，必填非空
//   - Source：反馈来源，"" 时由 DB 兜底为 'wechat'
//   - AttachmentIDs：可选附件 file_id 列表，与 feedback 同事务 INSERT 进 feedback_attachments
type CreateFeedbackInput struct {
	Content       string
	Source        string
	AttachmentIDs []int64
}

// ============================================================
// FeedbackService 实现
// ============================================================

// feedbackService 是 FeedbackService 的具体实现。
type feedbackService struct {
	pool  *pgxpool.Pool
	notif NotificationService // Phase 12：可选，nil 时跳过通知（向后兼容旧测试）
}

// 编译时校验
var _ FeedbackService = (*feedbackService)(nil)

// FeedbackServiceDeps 装配 NewFeedbackService 所需依赖。
//
// Phase 12：NotificationService 可选 —— 单元测试可不传，service 不发通知；
// 生产 main.go 必传以驱动 new_feedback 通知。
type FeedbackServiceDeps struct {
	Pool                *pgxpool.Pool
	NotificationService NotificationService
}

// NewFeedbackService 构造 FeedbackService。
func NewFeedbackService(deps FeedbackServiceDeps) (FeedbackService, error) {
	if deps.Pool == nil {
		return nil, errors.New("feedback_service: pool is required")
	}
	return &feedbackService{pool: deps.Pool, notif: deps.NotificationService}, nil
}

// ============================================================
// 输入校验 helper
// ============================================================

// validFeedbackSources 与 0001 migration enum + openapi.yaml FeedbackSource 一一对应。
// 改 enum 时三处必须同步改：DB enum / openapi.yaml / 此白名单。
var validFeedbackSources = map[string]bool{
	"phone":   true,
	"wechat":  true,
	"email":   true,
	"meeting": true,
	"other":   true,
}

// validFeedbackStatuses 与 0001 migration enum + openapi.yaml FeedbackStatus 一一对应。
var validFeedbackStatuses = map[string]bool{
	"pending": true,
	"done":    true,
}

// ============================================================
// List
// ============================================================

// List 按 project_id 列出反馈。
//
// 业务流程：
//  1. 校验 sc 是 AuthContext（fail-fast 拒绝匿名）
//  2. 事务内 SET LOCAL app.user_id / app.role_id（让 RLS 策略 feedbacks_all 起作用）
//  3. SELECT feedbacks WHERE project_id = $1 ORDER BY recorded_at ASC
//     —— 时间正序便于前端做"按时间流水"展示；非成员看到空列表（RLS 拦截）
//  4. 对每条反馈再 SELECT feedback_attachments 拿 file_id 列表
//
// 设计取舍：
//   - 不在 SQL 用 array_agg/json_agg 聚合 attachments：v1 反馈通常 0~3 个附件，
//     N+1 查询的额外成本相对透明、便于排错；后续 P95 实测高再优化
//   - ORDER BY ASC：与 v1 plan 中 DESC 不同，但 spec §4 + 前端 UI 要求按时间正序流水展示，
//     正序对齐"客户问题逐渐解决"的语义
func (s *feedbackService) List(ctx context.Context, sc SessionContext, projectID int64) ([]any, error) {
	ac, ok := sc.(AuthContext)
	if !ok {
		return nil, errors.New("feedback_service: invalid session context type")
	}

	var feedbacks []Feedback
	err := progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		// RLS GUC 注入：让 feedbacks_all 策略看到正确身份
		if err := progressdb.SetSessionContext(ctx, tx, ac.UserID, ac.RoleID); err != nil {
			return fmt.Errorf("feedback_service: set rls context: %w", err)
		}

		rows, err := tx.Query(ctx, `
			SELECT id, project_id, content, source::TEXT, status::TEXT, recorded_by, recorded_at
			FROM feedbacks
			WHERE project_id = $1
			ORDER BY recorded_at ASC
		`, projectID)
		if err != nil {
			return fmt.Errorf("feedback_service: query feedbacks: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			var f Feedback
			if err := rows.Scan(
				&f.ID, &f.ProjectID, &f.Content, &f.Source, &f.Status,
				&f.RecordedBy, &f.RecordedAt,
			); err != nil {
				return fmt.Errorf("feedback_service: scan feedback: %w", err)
			}
			feedbacks = append(feedbacks, f)
		}
		if err := rows.Err(); err != nil {
			return fmt.Errorf("feedback_service: iterate feedbacks: %w", err)
		}

		// 二次查附件（同事务，RLS 仍生效）
		for i := range feedbacks {
			ids, err := loadAttachmentIDs(ctx, tx, feedbacks[i].ID)
			if err != nil {
				return err
			}
			feedbacks[i].AttachmentIDs = ids
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	// 转 []any 满足 interface（FeedbackService.List 签名 = []any）
	out := make([]any, 0, len(feedbacks))
	for _, f := range feedbacks {
		out = append(out, f)
	}
	return out, nil
}

// ============================================================
// Create
// ============================================================

// Create 录入一条反馈。
//
// 业务流程：
//  1. 校验 sc + 校验 input：content 非空（trim 后），source 在白名单或 ""
//  2. 事务内 SET LOCAL GUC + INSERT feedbacks (..., recorded_by=ac.UserID)
//     RETURNING 全字段
//  3. 若 input.AttachmentIDs 非空：UNNEST 一条 INSERT 进 feedback_attachments
//  4. 再 SELECT 一遍 attachments 拼装到结果（统一返回路径：与 List 输出一致）
//
// 设计取舍：
//   - 同事务 INSERT attachments：避免"feedback 已写但 attachments 失败"的脏状态；
//     RLS 策略 feedback_attachments_all 在 USING/WITH CHECK 都查 is_member(feedback.project_id)，
//     非成员的写入会被 RLS 拦下
//   - source = "" 时不传给 SQL，让 DB DEFAULT 'wechat' 兜底；显式传入则白名单校验
//   - 通知 outbox（new_feedback）由 Phase 12 接入，本函数返回 feedback 后由 caller 决定是否发通知；
//     spec 与 plan 都允许 v1 不实现通知（功能可降级显示，但不做静默 swallow notif 写入失败）
func (s *feedbackService) Create(ctx context.Context, sc SessionContext, projectID int64, input any) (any, error) {
	ac, ok := sc.(AuthContext)
	if !ok {
		return nil, errors.New("feedback_service: invalid session context type")
	}
	in, ok := input.(CreateFeedbackInput)
	if !ok {
		return nil, errors.New("feedback_service: invalid create input type")
	}

	// 业务校验：content 必填
	content := strings.TrimSpace(in.Content)
	if content == "" {
		return nil, ErrFeedbackContentEmpty
	}
	// source 校验：空字符串走 DB 兜底；非空必须在白名单
	if in.Source != "" && !validFeedbackSources[in.Source] {
		return nil, ErrFeedbackInvalidSource
	}

	var f Feedback
	err := progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := progressdb.SetSessionContext(ctx, tx, ac.UserID, ac.RoleID); err != nil {
			return fmt.Errorf("feedback_service: set rls context: %w", err)
		}

		// INSERT feedbacks：source 空字符串 → 走 DB DEFAULT；非空显式赋值
		var row pgx.Row
		if in.Source == "" {
			row = tx.QueryRow(ctx, `
				INSERT INTO feedbacks (project_id, content, recorded_by)
				VALUES ($1, $2, $3)
				RETURNING id, project_id, content, source::TEXT, status::TEXT, recorded_by, recorded_at
			`, projectID, content, ac.UserID)
		} else {
			row = tx.QueryRow(ctx, `
				INSERT INTO feedbacks (project_id, content, source, recorded_by)
				VALUES ($1, $2, $3::feedback_source, $4)
				RETURNING id, project_id, content, source::TEXT, status::TEXT, recorded_by, recorded_at
			`, projectID, content, in.Source, ac.UserID)
		}
		if err := row.Scan(
			&f.ID, &f.ProjectID, &f.Content, &f.Source, &f.Status,
			&f.RecordedBy, &f.RecordedAt,
		); err != nil {
			return fmt.Errorf("feedback_service: insert feedback: %w", err)
		}

		// 同事务 INSERT 附件
		if len(in.AttachmentIDs) > 0 {
			if _, err := tx.Exec(ctx, `
				INSERT INTO feedback_attachments (feedback_id, file_id)
				SELECT $1, UNNEST($2::BIGINT[])
			`, f.ID, in.AttachmentIDs); err != nil {
				return fmt.Errorf("feedback_service: insert attachments: %w", err)
			}
			// 拼装到返回结构（保持调用方拿到的 Feedback 与 List 行为一致）
			f.AttachmentIDs = append([]int64(nil), in.AttachmentIDs...)
		}

		// ============================================================
		// Phase 12：同事务给项目成员（除录入人外）发 new_feedback 通知
		//
		// 业务流程：
		//   1. 查 project_members where project_id 排除 ac.UserID
		//   2. 对每个 user 调 notif.Create(tx, ...) 走 SECURITY DEFINER 函数
		//   3. 任一失败 → 回滚整个 tx（feedback INSERT 也撤销）
		//
		// 设计取舍：
		//   - notif=nil 时跳过通知（兼容老测试 / 不依赖通知模块的部署）
		//   - 通知失败不静默吞 —— v2 part5 §NC2 "禁止降级回退"
		//   - 排除录入人：自己录的反馈不需要通知自己
		// ============================================================
		if s.notif != nil {
			rows, err := tx.Query(ctx, `
				SELECT user_id FROM project_members
				WHERE project_id = $1 AND user_id != $2
			`, projectID, ac.UserID)
			if err != nil {
				return fmt.Errorf("feedback_service: query project members: %w", err)
			}
			var memberIDs []int64
			for rows.Next() {
				var uid int64
				if err := rows.Scan(&uid); err != nil {
					rows.Close()
					return fmt.Errorf("feedback_service: scan member: %w", err)
				}
				memberIDs = append(memberIDs, uid)
			}
			rows.Close()
			if err := rows.Err(); err != nil {
				return fmt.Errorf("feedback_service: iterate members: %w", err)
			}

			pid := projectID
			title := "新反馈"
			body := "项目收到一条新反馈"
			for _, uid := range memberIDs {
				if _, err := s.notif.Create(ctx, tx, uid, "new_feedback", &pid, title, body); err != nil {
					return fmt.Errorf("feedback_service: create notification for user %d: %w", uid, err)
				}
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return f, nil
}

// ============================================================
// UpdateStatus
// ============================================================

// UpdateStatus 仅允许更新 status 字段（pending ⇄ done）。
//
// 业务流程：
//  1. 校验 sc + status 在白名单
//  2. 事务内 SET LOCAL GUC + UPDATE feedbacks SET status=$1 WHERE id=$2 RETURNING 全字段
//     —— RLS 策略 feedbacks_all 的 USING + WITH CHECK 双重把关，
//        非成员的 UPDATE 既找不到行也写不进去
//  3. 若 RETURNING 0 行 → 反馈不存在或无权 → ErrFeedbackNotFound
//  4. 重新 SELECT 附件拼装返回（保持输出一致）
//
// 设计取舍：
//   - 不允许更新 content / source / recorded_by 等字段（spec §4 反馈是审计流水，
//     录入后内容不可篡改；想纠错只能新建一条）
//   - 不实现"改 status 时清掉 attachments"等副作用：附件归属反馈条目，状态独立
func (s *feedbackService) UpdateStatus(ctx context.Context, sc SessionContext, feedbackID int64, status string) (any, error) {
	ac, ok := sc.(AuthContext)
	if !ok {
		return nil, errors.New("feedback_service: invalid session context type")
	}
	if !validFeedbackStatuses[status] {
		return nil, ErrFeedbackInvalidStatus
	}

	var f Feedback
	err := progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := progressdb.SetSessionContext(ctx, tx, ac.UserID, ac.RoleID); err != nil {
			return fmt.Errorf("feedback_service: set rls context: %w", err)
		}

		row := tx.QueryRow(ctx, `
			UPDATE feedbacks
			SET status = $1::feedback_status
			WHERE id = $2
			RETURNING id, project_id, content, source::TEXT, status::TEXT, recorded_by, recorded_at
		`, status, feedbackID)
		if err := row.Scan(
			&f.ID, &f.ProjectID, &f.Content, &f.Source, &f.Status,
			&f.RecordedBy, &f.RecordedAt,
		); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrFeedbackNotFound
			}
			return fmt.Errorf("feedback_service: update status: %w", err)
		}

		ids, err := loadAttachmentIDs(ctx, tx, f.ID)
		if err != nil {
			return err
		}
		f.AttachmentIDs = ids
		return nil
	})
	if err != nil {
		return nil, err
	}
	return f, nil
}

// ============================================================
// 内部 helper
// ============================================================

// loadAttachmentIDs 查询某 feedback_id 关联的所有 file_id（按 id 升序，稳定输出）。
//
// 业务背景：调用方都在 InTx 内、RLS 已注入；feedback_attachments_all 策略
// 通过 feedback → project 间接判定 is_member，未越权访问能直接拿到结果。
func loadAttachmentIDs(ctx context.Context, tx pgx.Tx, feedbackID int64) ([]int64, error) {
	rows, err := tx.Query(ctx, `
		SELECT file_id FROM feedback_attachments
		WHERE feedback_id = $1
		ORDER BY id
	`, feedbackID)
	if err != nil {
		return nil, fmt.Errorf("feedback_service: query attachments: %w", err)
	}
	defer rows.Close()

	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("feedback_service: scan attachment: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("feedback_service: iterate attachments: %w", err)
	}
	return ids, nil
}
