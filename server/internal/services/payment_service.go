/*
@file payment_service.go
@description PaymentService 实现 —— Phase 9 Worker F：
             - List(projectID)：列出项目下的收款/结算流水（按 paid_at DESC）
             - Create(projectID, input)：录入一条收款或开发结算
             - MyEarnings(sc)：当前登录用户的开发结算视图（dev_earnings_view 强制按 user_id 过滤）

             业务规则（migrations 0001 + spec §4.1）：
             - amount 必须 > 0（DB CHECK 约束 + 应用层兜底，便于前端拿到 422 而不是 23514 PG 错码）
             - direction ∈ {customer_in, dev_settlement}（PG enum payment_direction 约束）
             - direction = dev_settlement 时 related_user_id + screenshot_id 必填（DB CHECK + 应用层兜底）
             - direction = customer_in 时同事务 UPDATE projects.total_received（spec §4.1）
             - remark 必填（DB NOT NULL；空串也走应用层校验避免误判"漏填"）

             RLS GUC 注入：
             - 所有写入路径（Create）在事务内 SetSessionContext，让 RLS helper 看到注入身份
             - List 也走事务（虽然只读，但 progress_app 角色 + RLS policy 要求 GUC 注入才放行）
             - MyEarnings 在事务内查 dev_earnings_view —— view 设为 security_barrier，
               配合 SetSessionContext 之后 0002 migration 的 helper 函数会把 user_id 限制到自己

             与 NotificationService 的协作（v2 part2 §W3）：
             - 本 service 内不直接发通知，避免与 Phase 12 NotificationService 形成循环依赖
             - dev_settlement 通知（settlement_received）由 Phase 12 outbox worker 在
               commit 后异步派发；当前 phase 仅写流水，通知会在 NotificationService 接入后追加
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
//
// 业务约定：
// - service 层把"业务校验失败"用 sentinel error 暴露；handler 层 errors.Is 后映射 422
// - 不暴露原始 PG SQLSTATE，避免泄漏 schema 细节并保持错误文案稳定
var (
	// ErrPaymentInvalidAmount amount 必须 > 0
	ErrPaymentInvalidAmount = errors.New("payment: amount must be > 0")

	// ErrPaymentInvalidDirection direction 必须是 customer_in / dev_settlement
	ErrPaymentInvalidDirection = errors.New("payment: invalid direction")

	// ErrPaymentRemarkRequired remark 不能为空
	ErrPaymentRemarkRequired = errors.New("payment: remark is required")

	// ErrPaymentSettlementMissingFields dev_settlement 必须有 related_user_id + screenshot_id
	ErrPaymentSettlementMissingFields = errors.New("payment: dev_settlement requires related_user_id and screenshot_id")

	// ErrPaymentProjectNotFound 项目不存在
	ErrPaymentProjectNotFound = errors.New("payment: project not found")
)

// ============================================================
// 公共 DTO
// ============================================================

// PaymentDirection 财务流向。
//
// 设计取舍：service 层定义自己的字符串常量，避免依赖 oas 包；
// handler 层负责 oas.PaymentDirection ↔ services.PaymentDirection 的转换
type PaymentDirection string

const (
	// PaymentDirectionCustomerIn 客户付款入账（累加 projects.total_received）
	PaymentDirectionCustomerIn PaymentDirection = "customer_in"

	// PaymentDirectionDevSettlement 开发结算出账（必须有 related_user_id + screenshot_id）
	PaymentDirectionDevSettlement PaymentDirection = "dev_settlement"
)

// IsValid 判断 direction 是否合法。
func (d PaymentDirection) IsValid() bool {
	return d == PaymentDirectionCustomerIn || d == PaymentDirectionDevSettlement
}

// Payment 数据库行映射。
//
// Money 走 db.Money（NUMERIC text codec），保证全链路无浮点精度损失。
type Payment struct {
	ID            int64
	ProjectID     int64
	Direction     PaymentDirection
	Amount        progressdb.Money
	PaidAt        time.Time
	RelatedUserID *int64 // dev_settlement 必填
	ScreenshotID  *int64 // dev_settlement 必填
	Remark        string
	RecordedBy    int64
	RecordedAt    time.Time
}

// PaymentCreateInput Create 入参。
//
// 业务背景：handler 层把 oas.PaymentCreateRequest 映射成本结构传给 service；
// service 接收纯 Go 类型，便于单元测试时绕过 oas 类型构造
type PaymentCreateInput struct {
	Direction     PaymentDirection
	Amount        progressdb.Money
	PaidAt        time.Time
	RelatedUserID *int64
	ScreenshotID  *int64
	Remark        string

	// RecordedBy 由 handler 从 AuthContext 注入（不让前端传，防止伪造记账人）
	RecordedBy int64
}

// EarningsProject 单个项目的结算汇总（per-project breakdown）。
type EarningsProject struct {
	ProjectID       int64
	ProjectName     string
	TotalEarned     progressdb.Money
	SettlementCount int
	LastPaidAt      *time.Time
}

// EarningsSummary 当前用户全部项目的结算总览。
//
// 业务背景：dev_earnings_view 是 per-project 行；本 struct 在 service 层
// 把行列再一次聚合为"用户级"汇总：totalEarned = SUM(per-project)，
// settlementCount = SUM(per-project count)，lastPaidAt = MAX(per-project lastPaidAt)
type EarningsSummary struct {
	UserID          int64
	TotalEarned     progressdb.Money
	SettlementCount int
	LastPaidAt      *time.Time
	Projects        []EarningsProject
}

// ============================================================
// PaymentServiceDeps & 构造
// ============================================================

// PaymentServiceDeps 装配 NewPaymentService 所需依赖。
type PaymentServiceDeps struct {
	Pool *pgxpool.Pool
}

// paymentService 是 PaymentService 的具体实现。
type paymentService struct {
	pool *pgxpool.Pool
}

// 编译时校验：实现满足 PaymentService 接口契约（interfaces.go 中已声明）
var _ PaymentService = (*paymentService)(nil)

// NewPaymentService 构造 PaymentService。
func NewPaymentService(deps PaymentServiceDeps) (PaymentService, error) {
	if deps.Pool == nil {
		return nil, errors.New("payment_service: pool is required")
	}
	return &paymentService{pool: deps.Pool}, nil
}

// ============================================================
// List
// ============================================================

// List 列出项目下的全部 payment 流水（含 customer_in 和 dev_settlement，按 paid_at DESC）。
//
// 业务流程：
//  1. 从 sc 取 AuthContext 注入 RLS GUC
//  2. 在事务内 SELECT FROM payments WHERE project_id=$1 ORDER BY paid_at DESC
//  3. 每行 Scan 后追加到结果切片
//
// 返回：
//   - []any 而非 []Payment 是为了对齐 PaymentService interface（interfaces.go），
//     handler 层做类型断言后再转 oas 模型
func (s *paymentService) List(ctx context.Context, sc SessionContext, projectID int64) ([]any, error) {
	ac, ok := sc.(AuthContext)
	if !ok {
		return nil, errors.New("payment: invalid session context")
	}

	var out []any
	err := progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := progressdb.SetSessionContext(ctx, tx, ac.UserID, ac.RoleID); err != nil {
			return err
		}

		rows, err := tx.Query(ctx, `
			SELECT id, project_id, direction, amount, paid_at,
			       related_user_id, screenshot_id, remark, recorded_by, recorded_at
			FROM payments
			WHERE project_id = $1
			ORDER BY paid_at DESC, id DESC
		`, projectID)
		if err != nil {
			return fmt.Errorf("payment: query payments: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			var (
				p             Payment
				directionRaw  string
				relatedUserID *int64
				screenshotID  *int64
			)
			if err := rows.Scan(
				&p.ID, &p.ProjectID, &directionRaw, &p.Amount, &p.PaidAt,
				&relatedUserID, &screenshotID, &p.Remark, &p.RecordedBy, &p.RecordedAt,
			); err != nil {
				return fmt.Errorf("payment: scan row: %w", err)
			}
			p.Direction = PaymentDirection(directionRaw)
			p.RelatedUserID = relatedUserID
			p.ScreenshotID = screenshotID
			out = append(out, p)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// ============================================================
// Create
// ============================================================

// Create 录入一条 payment 流水。
//
// 业务流程：
//  1. 解 SessionContext 拿到 RecordedBy 默认值（已由 handler 注入到 input.RecordedBy，但留兜底）
//  2. 应用层校验：direction / amount / remark / dev_settlement 字段
//  3. 事务内：
//     a. SetSessionContext 注入 RLS GUC
//     b. 校验项目存在（避免 PG FK 错码 23503 暴露给前端）
//     c. INSERT INTO payments RETURNING 全字段
//     d. 若 direction=customer_in：UPDATE projects SET total_received = total_received + $amount
//     e. （Phase 12 接入后）若 direction=dev_settlement：调 NotificationService.Create(tx, ...)
//
// 设计取舍：
//   - 应用层校验在事务前做：减少不必要的 BEGIN/ROLLBACK 开销（amount<=0 立刻拒绝）
//   - DB CHECK 约束作为"最后防线"：即便应用层漏校验，PG 也不会写脏数据
//   - INSERT 的 paid_at 用 input.PaidAt（前端可指定历史日期，便于补录）
//
// input 参数类型在 interface 是 any，本实现要求 PaymentCreateInput
func (s *paymentService) Create(ctx context.Context, sc SessionContext, projectID int64, rawInput any) (any, error) {
	ac, ok := sc.(AuthContext)
	if !ok {
		return nil, errors.New("payment: invalid session context")
	}
	input, ok := rawInput.(PaymentCreateInput)
	if !ok {
		return nil, errors.New("payment: input must be PaymentCreateInput")
	}

	// ============================================================
	// 第一步：应用层校验
	// 业务规则：
	//   1) amount > 0
	//   2) direction ∈ {customer_in, dev_settlement}
	//   3) remark 非空
	//   4) dev_settlement 必填 related_user_id + screenshot_id
	// ============================================================
	if input.Amount.Decimal.Sign() <= 0 {
		return nil, ErrPaymentInvalidAmount
	}
	if !input.Direction.IsValid() {
		return nil, ErrPaymentInvalidDirection
	}
	if input.Remark == "" {
		return nil, ErrPaymentRemarkRequired
	}
	if input.Direction == PaymentDirectionDevSettlement {
		if input.RelatedUserID == nil || input.ScreenshotID == nil {
			return nil, ErrPaymentSettlementMissingFields
		}
	}

	// 兜底：input.RecordedBy 优先；若 handler 未填则用 AuthContext.UserID
	recordedBy := input.RecordedBy
	if recordedBy == 0 {
		recordedBy = ac.UserID
	}

	// ============================================================
	// 第二步：事务内写入 + 项目金额累加
	// ============================================================
	var out Payment
	err := progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := progressdb.SetSessionContext(ctx, tx, ac.UserID, ac.RoleID); err != nil {
			return err
		}

		// 项目存在性检查 —— 让"不存在"返回 ErrPaymentProjectNotFound 而不是 23503 FK 错
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM projects WHERE id = $1)`, projectID).Scan(&exists); err != nil {
			return fmt.Errorf("payment: check project existence: %w", err)
		}
		if !exists {
			return ErrPaymentProjectNotFound
		}

		// INSERT payments + RETURNING 全字段
		var (
			directionRaw  string
			relatedUserID *int64
			screenshotID  *int64
		)
		err := tx.QueryRow(ctx, `
			INSERT INTO payments (
				project_id, direction, amount, paid_at,
				related_user_id, screenshot_id, remark, recorded_by
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			RETURNING id, project_id, direction, amount, paid_at,
			          related_user_id, screenshot_id, remark, recorded_by, recorded_at
		`,
			projectID, string(input.Direction), input.Amount, input.PaidAt,
			input.RelatedUserID, input.ScreenshotID, input.Remark, recordedBy,
		).Scan(
			&out.ID, &out.ProjectID, &directionRaw, &out.Amount, &out.PaidAt,
			&relatedUserID, &screenshotID, &out.Remark, &out.RecordedBy, &out.RecordedAt,
		)
		if err != nil {
			return fmt.Errorf("payment: insert payment: %w", err)
		}
		out.Direction = PaymentDirection(directionRaw)
		out.RelatedUserID = relatedUserID
		out.ScreenshotID = screenshotID

		// 客户付款累加 projects.total_received（同事务原子）
		if input.Direction == PaymentDirectionCustomerIn {
			if _, err := tx.Exec(ctx, `
				UPDATE projects
				SET total_received = total_received + $1
				WHERE id = $2
			`, input.Amount, projectID); err != nil {
				return fmt.Errorf("payment: update project total_received: %w", err)
			}
		}

		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// ============================================================
// MyEarnings
// ============================================================

// MyEarnings 返回当前用户的开发结算汇总。
//
// 业务流程：
//  1. 从 sc 取 AuthContext.UserID
//  2. 事务内 SetSessionContext + SELECT * FROM dev_earnings_view WHERE user_id = $1
//     （view 是 security_barrier，配合 RLS helper 限制只能看到自己的结算）
//  3. 在 service 层把 per-project 行聚合为顶层 totalEarned / settlementCount / lastPaidAt
//
// 安全语义（核心保证）：
//   - 应用层显式 WHERE user_id = $auth_uid：即便 view 的 security_barrier 失效，
//     第二层 WHERE 兜底；与 plan §9.1 "应用层强制 RLS 过滤"对齐
//   - 不接受外部传入的 userID：永远用 AuthContext.UserID，避免越权读其他人收益
//
// 返回类型 any（接口契约）；handler 层做类型断言后映射成 oas.EarningsSummary
func (s *paymentService) MyEarnings(ctx context.Context, sc SessionContext) (any, error) {
	ac, ok := sc.(AuthContext)
	if !ok {
		return nil, errors.New("payment: invalid session context")
	}

	out := EarningsSummary{
		UserID:   ac.UserID,
		Projects: []EarningsProject{},
	}
	err := progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := progressdb.SetSessionContext(ctx, tx, ac.UserID, ac.RoleID); err != nil {
			return err
		}

		// dev_earnings_view 字段：user_id, project_id, project_name, total_earned, settlement_count, last_paid_at
		// 应用层强制 user_id = ac.UserID，与 RLS 双重防御
		rows, err := tx.Query(ctx, `
			SELECT project_id, project_name, total_earned, settlement_count, last_paid_at
			FROM dev_earnings_view
			WHERE user_id = $1
			ORDER BY last_paid_at DESC NULLS LAST, project_id
		`, ac.UserID)
		if err != nil {
			return fmt.Errorf("payment: query earnings: %w", err)
		}
		defer rows.Close()

		// 聚合：sum + max
		totalEarned := progressdb.Money{}
		var settlementCount int
		var lastPaidAt *time.Time

		for rows.Next() {
			var (
				p          EarningsProject
				lastPaid   *time.Time
				perAmount  progressdb.Money
				perCount   int
			)
			if err := rows.Scan(&p.ProjectID, &p.ProjectName, &perAmount, &perCount, &lastPaid); err != nil {
				return fmt.Errorf("payment: scan earnings row: %w", err)
			}
			p.TotalEarned = perAmount
			p.SettlementCount = perCount
			p.LastPaidAt = lastPaid
			out.Projects = append(out.Projects, p)

			// 顶层聚合：金额累加 + 次数累加 + 最近一次时间取 max
			totalEarned = progressdb.Money{Decimal: totalEarned.Decimal.Add(perAmount.Decimal)}
			settlementCount += perCount
			if lastPaid != nil {
				if lastPaidAt == nil || lastPaid.After(*lastPaidAt) {
					t := *lastPaid
					lastPaidAt = &t
				}
			}
		}
		if err := rows.Err(); err != nil {
			return fmt.Errorf("payment: iterate earnings: %w", err)
		}

		out.TotalEarned = totalEarned
		out.SettlementCount = settlementCount
		out.LastPaidAt = lastPaidAt
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}
