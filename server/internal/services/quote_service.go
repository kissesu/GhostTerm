/*
@file quote_service.go
@description 费用变更子系统 service 层 —— Phase 8 Worker E。

             业务背景（spec §7）：
             - 与状态机正交：报价 / 费用变更可在任意非终态状态发生，与 status 转换分离
             - 三种 change_type（与 0001 migration enum 对齐）：
                 * append      ：客户加新功能 → current_quote += delta
                 * modify      ：商务让利 / 调整 → current_quote = new_quote
                 * after_sales ：售后期内追加 → current_quote += delta，after_sales_total += delta

             核心保证（用户痛点：避免对账偏差）：
             1. 全部金额走 db.Money（NUMERIC text codec），禁止 float64 让浮点误差影响财务总账
             2. 写 quote_change_logs + UPDATE projects 必须同事务，任一失败整体回滚
             3. RLS：service 层在事务内调用 db.SetSessionContext 注入 user_id / role_id，
                让 quote_change_logs 与 projects 表的 RLS 策略生效（is_admin / is_member 判定）

             权限（spec §7.3）：
             - 仅 客服(role_id=3) + 超管(role_id=1) 可触发 quote_change:create
             - 开发(2) 不可触发，避免越权改对客户报价
             - 当前 0001 migration 尚未把 'quote_change' 资源加入 permissions 表，
               handler 层先用 roleID 白名单做粗粒度门，待 migration 演进后再切换到
               RBACService.HasPermission("quote_change:create")

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

// QuoteChangeType 是费用变更类型（与 0001 migration ENUM 对齐）。
type QuoteChangeType string

const (
	QuoteChangeAppend     QuoteChangeType = "append"
	QuoteChangeModify     QuoteChangeType = "modify"
	QuoteChangeAfterSales QuoteChangeType = "after_sales"
)

// QuoteChangeLog 是 quote_change_logs 行的 service 层视图。
//
// 字段命名与 OAS QuoteChange schema 对齐，handler 层做小写驼峰映射时一一对应。
// Money 字段全部用 db.Money（不用 float64）—— v2 part5 §NC5 要求金额全链路 string 化。
type QuoteChangeLog struct {
	ID         int64
	ProjectID  int64
	ChangeType QuoteChangeType
	Delta      progressdb.Money
	OldQuote   progressdb.Money
	NewQuote   progressdb.Money
	Reason     string
	Phase      string // ProjectStatus 字面量（dealing/quoting/...）
	ChangedBy  int64
	ChangedAt  time.Time
}

// QuoteChangeInput 是创建费用变更的输入（service 层 DTO）。
//
// 业务约束：
//   - reason 必填（DB 列 NOT NULL，且业务侧再做 trim 校验）
//   - append / after_sales 必须填 Delta（不能是零值 Money）
//   - modify 必须填 NewQuote（不能是零值 Money）
//   - changedBy 必须是当前 session 的 user_id（handler 层从 AuthContext 取，service 层信任）
type QuoteChangeInput struct {
	ProjectID  int64
	ChangeType QuoteChangeType
	// Delta：append/after_sales 用；service 内部计算 modify 的 delta = newQuote - oldQuote
	Delta *progressdb.Money
	// NewQuote：modify 用
	NewQuote  *progressdb.Money
	Reason    string
	ChangedBy int64
	// RoleID 用于 RLS 注入（与 ChangedBy 一起走 SetSessionContext）
	RoleID int64
}

// QuoteService 实现 service 层费用变更逻辑。
//
// 设计取舍：
//   - 不实现 services.QuoteChangeService interface（接口签名为 any，类型不安全）；
//     handler 直接持有 *QuoteService，类型对齐
//   - 不接受外部 tx：本 service 自己 BEGIN/COMMIT，确保 UPDATE projects + INSERT log 原子性
//   - 不发通知（spec §8 通知矩阵中没有 quote_change 类）
type QuoteService struct {
	pool *pgxpool.Pool
}

// NewQuoteService 构造 QuoteService。
func NewQuoteService(pool *pgxpool.Pool) (*QuoteService, error) {
	if pool == nil {
		return nil, errors.New("quote_service: pool is required")
	}
	return &QuoteService{pool: pool}, nil
}

// Sentinel errors：handler 据此映射 HTTP 状态。
var (
	// ErrQuoteValidation 入参校验失败（reason 空 / delta 缺失 / 类型未知）→ 422
	ErrQuoteValidation = errors.New("quote_service: validation failed")
	// ErrQuoteProjectNotFound 项目不存在 → 404
	ErrQuoteProjectNotFound = errors.New("quote_service: project not found")
)

// ListChanges 返回项目的费用变更日志。
//
// 业务流程：
//  1. InTx + SetSessionContext 注入 RLS 身份
//  2. SELECT 按 changed_at ASC 排序（用户痛点：时间线显示）
//  3. RLS 已经按 is_admin/is_member 过滤；非 member 用户得到空切片（不报 404）
//
// 注：spec/plan 文本里 "ORDER BY changed_at DESC" 与 "ORDER BY changed_at ASC" 混用；
// 任务卡明确要求 ASC（"ordered by changed_at ASC"）—— 与变更时间线 UI 显示一致。
func (s *QuoteService) ListChanges(ctx context.Context, sc AuthContext, projectID int64) ([]QuoteChangeLog, error) {
	var out []QuoteChangeLog
	err := progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := progressdb.SetSessionContext(ctx, tx, sc.UserID, sc.RoleID); err != nil {
			return fmt.Errorf("quote_service: inject RLS ctx: %w", err)
		}
		rows, err := tx.Query(ctx, `
			SELECT id, project_id, change_type, delta, old_quote, new_quote,
			       reason, phase, changed_by, changed_at
			FROM quote_change_logs
			WHERE project_id = $1
			ORDER BY changed_at ASC
		`, projectID)
		if err != nil {
			return fmt.Errorf("quote_service: query logs: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var l QuoteChangeLog
			if err := rows.Scan(
				&l.ID, &l.ProjectID, &l.ChangeType,
				&l.Delta, &l.OldQuote, &l.NewQuote,
				&l.Reason, &l.Phase, &l.ChangedBy, &l.ChangedAt,
			); err != nil {
				return fmt.Errorf("quote_service: scan log: %w", err)
			}
			out = append(out, l)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// CreateChange 创建一条费用变更并同事务更新项目当前报价。
//
// 业务流程（核心：原子性）：
//  1. 入参校验（change_type / reason / delta-newquote 二选一），违反 → ErrQuoteValidation
//  2. InTx 开启事务 + SetSessionContext 注入 RLS 身份
//  3. SELECT current_quote, after_sales_total, status FROM projects FOR UPDATE
//     —— FOR UPDATE 防并发 race（两个 append 同时写会偷掉对方的 delta）
//  4. 按 change_type 计算 newQuote / delta / 是否累加 after_sales_total
//  5. UPDATE projects 写回 current_quote（+ 售后追加 after_sales_total）
//  6. INSERT quote_change_logs 写入完整快照（含 old/new/phase/reason/user）
//  7. COMMIT；任一步失败回滚（InTx 自动）
//
// RLS 注意：
//   - 步骤 5 的 UPDATE projects 受 0002 migration projects_update RLS 限制（is_admin OR is_member）；
//     非项目成员调用会被拦截（service 仍返回 ErrQuoteProjectNotFound 让 handler 映射 404，
//     不暴露"行存在但不能改"避免泄漏）
//   - 步骤 6 的 INSERT 受 quote_changes_insert RLS（同样 is_admin OR is_member）
func (s *QuoteService) CreateChange(ctx context.Context, sc AuthContext, in QuoteChangeInput) (*QuoteChangeLog, error) {
	// ============================================
	// 第一步：入参校验
	// ============================================
	if err := validateQuoteInput(&in); err != nil {
		return nil, err
	}

	var result QuoteChangeLog
	err := progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		// ============================================
		// 第二步：注入 RLS 身份
		// ============================================
		if err := progressdb.SetSessionContext(ctx, tx, sc.UserID, sc.RoleID); err != nil {
			return fmt.Errorf("quote_service: inject RLS ctx: %w", err)
		}

		// ============================================
		// 第三步：锁住项目行，读 current_quote / after_sales_total / status
		// FOR UPDATE 防止两个并发 append 互踢
		// ============================================
		var oldQuote, oldAfterSales progressdb.Money
		var status string
		err := tx.QueryRow(ctx, `
			SELECT current_quote, after_sales_total, status
			FROM projects
			WHERE id = $1
			FOR UPDATE
		`, in.ProjectID).Scan(&oldQuote, &oldAfterSales, &status)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrQuoteProjectNotFound
			}
			return fmt.Errorf("quote_service: select project: %w", err)
		}

		// ============================================
		// 第四步：按 change_type 计算 delta / newQuote
		// 用 db.Money（decimal）做加减，避免 float64 误差
		// ============================================
		var newQuote progressdb.Money
		var delta progressdb.Money

		switch in.ChangeType {
		case QuoteChangeAppend:
			// delta 已校验非空
			delta = *in.Delta
			newQuote = progressdb.Money{Decimal: oldQuote.Add(delta.Decimal)}

		case QuoteChangeModify:
			// newQuote 已校验非空
			newQuote = *in.NewQuote
			// delta = newQuote - oldQuote（可能为负，让利）
			delta = progressdb.Money{Decimal: newQuote.Sub(oldQuote.Decimal)}

		case QuoteChangeAfterSales:
			delta = *in.Delta
			newQuote = progressdb.Money{Decimal: oldQuote.Add(delta.Decimal)}
			// 同时累加 after_sales_total（仅本类型）
			newAfterSales := progressdb.Money{Decimal: oldAfterSales.Add(delta.Decimal)}
			if _, err := tx.Exec(ctx, `
				UPDATE projects SET after_sales_total = $1 WHERE id = $2
			`, newAfterSales, in.ProjectID); err != nil {
				return fmt.Errorf("quote_service: update after_sales_total: %w", err)
			}

		default:
			// validateQuoteInput 已经拒绝未知类型，此处兜底防御
			return fmt.Errorf("%w: unknown change_type %q", ErrQuoteValidation, in.ChangeType)
		}

		// ============================================
		// 第五步：UPDATE projects.current_quote
		// updated_at 由触发器自动维护（0001 migration update_updated_at_column）
		// ============================================
		ct, err := tx.Exec(ctx, `
			UPDATE projects SET current_quote = $1, updated_at = NOW()
			WHERE id = $2
		`, newQuote, in.ProjectID)
		if err != nil {
			return fmt.Errorf("quote_service: update current_quote: %w", err)
		}
		if ct.RowsAffected() == 0 {
			// 第三步的 SELECT 已经拿到行，UPDATE 0 行说明 RLS 拦截（行可见但不可改）
			// 把它折叠成 not_found 与外部观察一致，避免泄漏 RLS 边界
			return ErrQuoteProjectNotFound
		}

		// ============================================
		// 第六步：INSERT quote_change_logs 写入快照
		// RETURNING 拿回 id + changed_at（DB DEFAULT NOW()）
		// ============================================
		err = tx.QueryRow(ctx, `
			INSERT INTO quote_change_logs
			    (project_id, change_type, delta, old_quote, new_quote, reason, phase, changed_by)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			RETURNING id, project_id, change_type, delta, old_quote, new_quote,
			          reason, phase, changed_by, changed_at
		`, in.ProjectID, string(in.ChangeType), delta, oldQuote, newQuote,
			in.Reason, status, in.ChangedBy).Scan(
			&result.ID, &result.ProjectID, &result.ChangeType,
			&result.Delta, &result.OldQuote, &result.NewQuote,
			&result.Reason, &result.Phase, &result.ChangedBy, &result.ChangedAt,
		)
		if err != nil {
			return fmt.Errorf("quote_service: insert log: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &result, nil
}

// validateQuoteInput 校验 change_type / reason / delta-newquote 互斥规则。
//
// 业务规则：
//   - reason 必填（trim 后非空）
//   - append / after_sales 必须填 Delta；modify 必须填 NewQuote
//   - 未知 change_type 直接拒绝（避免无声落 DB 后被 enum 拦报内部错误）
func validateQuoteInput(in *QuoteChangeInput) error {
	if strings.TrimSpace(in.Reason) == "" {
		return fmt.Errorf("%w: reason 必填", ErrQuoteValidation)
	}
	switch in.ChangeType {
	case QuoteChangeAppend, QuoteChangeAfterSales:
		if in.Delta == nil {
			return fmt.Errorf("%w: %s 必须填 delta", ErrQuoteValidation, in.ChangeType)
		}
	case QuoteChangeModify:
		if in.NewQuote == nil {
			return fmt.Errorf("%w: modify 必须填 newQuote", ErrQuoteValidation)
		}
	default:
		return fmt.Errorf("%w: 未知 change_type %q", ErrQuoteValidation, in.ChangeType)
	}
	return nil
}

