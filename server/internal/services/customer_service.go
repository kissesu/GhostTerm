/*
@file customer_service.go
@description CustomerService 的具体实现（Phase 4 Worker A）。
             - List：返回当前 session 可见的客户列表（行级可见性由 RLS + customers_select policy 承担）
             - Get：按 id 取单个客户；RLS 拦截后表现为 ErrCustomerNotFound（不暴露 是否存在）
             - Create：当前用户成为 created_by；事务内 INSERT，RLS WITH CHECK 把 created_by IS NOT NULL 兜底
             - Update：仅 admin 或 created_by 可更新（RLS customers_update USING + WITH CHECK 双保险）

             RLS 注入约定（v2 part2 §W11+）：
             - 所有 CRUD 都在 db.InTx 内调 db.SetSessionContext(tx, userID, roleID)
             - 注入后的 SELECT/UPDATE/INSERT 自动受 customers RLS policy 约束
             - 测试用 postgres 超级用户连接时需先 SET LOCAL ROLE progress_app（见 customer_test.go）

             interfaces.go 把 CustomerService 的 List/Get/Create/Update 签名约定为 ([]any, error) /
             (any, error)，本文件实现层用具体类型（CustomerView / CreateCustomerInput / UpdateCustomerInput）
             并在 interface 边界做 type assertion；handler 层 type-assert 后转为 oas 模型。
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
// Sentinel errors —— handler 层据此映射到 ErrorEnvelope.code
// ============================================================

// ErrCustomerNotFound id 不存在或当前 session 无可见性（RLS 拦截）。
//
// 业务背景：刻意不区分"不存在"与"无权限"，避免按 id 探测客户存在性。
var ErrCustomerNotFound = errors.New("customer_not_found")

// ErrCustomerNameRequired Create / Update 时 nameWechat 为空。
var ErrCustomerNameRequired = errors.New("customer_name_required")

// ErrInvalidSessionContext sc 类型断言失败（caller bug，非业务错误）。
//
// 单独定义而非裸 errors.New("...")，方便测试 ErrorIs 断言。
var ErrInvalidSessionContext = errors.New("customer_service_invalid_session_context")

// ============================================================
// 视图模型（DB 层 → service 层）
// ============================================================

// CustomerView 是 List/Get/Create/Update 返回的客户视图。
//
// 字段对齐 0001 migration customers 表 + openapi.yaml Customer schema。
// Remark 用 *string：DB 层 NULL 与空串可区分，前端按 nullable 渲染。
type CustomerView struct {
	ID         int64
	NameWechat string
	Remark     *string
	CreatedBy  int64
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// CreateCustomerInput 是 Create 的入参（handler 层从 oas.CustomerCreateRequest 转入）。
type CreateCustomerInput struct {
	NameWechat string
	Remark     *string // nil = 不填；空字符串 = 显式空（前端可禁止）
}

// UpdateCustomerInput 是 Update 的入参。
//
// 字段都是指针：nil 表示"不变"，非 nil 表示"覆盖为该值"。
// Remark 的 nil/非 nil 区分由调用方包装：
//
//	UpdateCustomerInput{NameWechat: nil, Remark: ptr(string(""))}  // 仅清空 remark
//	UpdateCustomerInput{NameWechat: ptr("新名"), Remark: nil}      // 仅改名
type UpdateCustomerInput struct {
	NameWechat *string
	Remark     **string // **string：外层 nil="不变"；内层 nil="设为 NULL"；内层非 nil="设为该值"
}

// ============================================================
// customerService 实现
// ============================================================

// customerService 是 CustomerService 的具体实现。
//
// 字段：
//   - pool：业务连接池（NOBYPASSRLS）；所有 CRUD 都在 InTx 里调 SetSessionContext 后执行
type customerService struct {
	pool *pgxpool.Pool
}

// CustomerServiceDeps 装配 NewCustomerService 所需依赖。
type CustomerServiceDeps struct {
	Pool *pgxpool.Pool
}

// 编译时校验：customerService 必须满足 CustomerService interface
var _ CustomerService = (*customerService)(nil)

// NewCustomerService 构造 CustomerService 实现。
//
// 设计：必填字段缺失返回 error，与 AuthService / RBACService 风格一致。
func NewCustomerService(deps CustomerServiceDeps) (CustomerService, error) {
	if deps.Pool == nil {
		return nil, errors.New("customer_service: pool is required")
	}
	return &customerService{pool: deps.Pool}, nil
}

// ============================================================
// List
// ============================================================

// List 返回当前 session 可见的客户列表。
//
// 业务流程：
//  1. 把 sc 转成 AuthContext；非法类型返回 ErrInvalidSessionContext
//  2. InTx 内 SetSessionContext(userID, roleID) → 注入 RLS GUC
//  3. SELECT * FROM customers ORDER BY created_at DESC（RLS 自动按 customers_select 过滤）
//  4. 返回 []any（每个元素 = CustomerView 值），handler 层 type-assert
//
// 设计取舍：
//   - 不在 service 层拼 visibility WHERE：RLS 已经做了；重复过滤反而引入注入面
//   - PageQuery 的 Limit/Offset 当前 v1 不强制（业务量小），但保留参数以便 future 扩展
//     Limit <= 0 视为不分页；Offset <= 0 视为 0
func (s *customerService) List(ctx context.Context, sc SessionContext, q PageQuery) ([]any, error) {
	ac, ok := sc.(AuthContext)
	if !ok {
		return nil, ErrInvalidSessionContext
	}

	// 第二步：构造 SQL（带可选 LIMIT/OFFSET）
	sql := `
		SELECT id, name_wechat, remark, created_by, created_at, updated_at
		FROM customers
		ORDER BY created_at DESC
	`
	var args []any
	if q.Limit > 0 {
		sql += " LIMIT $1"
		args = append(args, q.Limit)
		if q.Offset > 0 {
			sql += " OFFSET $2"
			args = append(args, q.Offset)
		}
	}

	out := make([]any, 0)
	err := progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		// 第一步：注入 RLS 会话身份（必须在事务首行）
		if err := progressdb.SetSessionContext(ctx, tx, ac.UserID, ac.RoleID); err != nil {
			return fmt.Errorf("customer_service: set session ctx: %w", err)
		}
		rows, err := tx.Query(ctx, sql, args...)
		if err != nil {
			return fmt.Errorf("customer_service: query customers: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var v CustomerView
			if err := rows.Scan(&v.ID, &v.NameWechat, &v.Remark, &v.CreatedBy, &v.CreatedAt, &v.UpdatedAt); err != nil {
				return fmt.Errorf("customer_service: scan customer: %w", err)
			}
			out = append(out, v)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// ============================================================
// Get
// ============================================================

// Get 按 id 取单个客户。RLS 拦截或 id 不存在均返回 ErrCustomerNotFound。
func (s *customerService) Get(ctx context.Context, sc SessionContext, id int64) (any, error) {
	ac, ok := sc.(AuthContext)
	if !ok {
		return nil, ErrInvalidSessionContext
	}

	var v CustomerView
	err := progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := progressdb.SetSessionContext(ctx, tx, ac.UserID, ac.RoleID); err != nil {
			return fmt.Errorf("customer_service: set session ctx: %w", err)
		}
		row := tx.QueryRow(ctx, `
			SELECT id, name_wechat, remark, created_by, created_at, updated_at
			FROM customers
			WHERE id = $1
		`, id)
		if err := row.Scan(&v.ID, &v.NameWechat, &v.Remark, &v.CreatedBy, &v.CreatedAt, &v.UpdatedAt); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrCustomerNotFound
			}
			return fmt.Errorf("customer_service: scan customer: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return v, nil
}

// ============================================================
// Create
// ============================================================

// Create 创建客户，当前 session user 自动成为 created_by。
//
// 业务流程：
//  1. 校验 input 类型 + nameWechat 非空
//  2. InTx 注入 RLS GUC
//  3. INSERT customers (name_wechat, remark, created_by) VALUES (...)
//     RLS customers_insert WITH CHECK (current_user_id() IS NOT NULL) 兜底
//  4. RETURNING 全部字段，组装 CustomerView 返回
//
// 设计取舍：
//   - input 类型用 CreateCustomerInput，外部传 any 后内部 assert：
//     interface 用 any 是 Phase 0a 的 placeholder 设计；本文件实现层用具体类型保证类型安全
func (s *customerService) Create(ctx context.Context, sc SessionContext, input any) (any, error) {
	ac, ok := sc.(AuthContext)
	if !ok {
		return nil, ErrInvalidSessionContext
	}
	in, ok := input.(CreateCustomerInput)
	if !ok {
		return nil, fmt.Errorf("customer_service: input must be CreateCustomerInput, got %T", input)
	}
	// 业务校验：nameWechat 必填
	if in.NameWechat == "" {
		return nil, ErrCustomerNameRequired
	}

	var v CustomerView
	err := progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := progressdb.SetSessionContext(ctx, tx, ac.UserID, ac.RoleID); err != nil {
			return fmt.Errorf("customer_service: set session ctx: %w", err)
		}
		row := tx.QueryRow(ctx, `
			INSERT INTO customers (name_wechat, remark, created_by)
			VALUES ($1, $2, $3)
			RETURNING id, name_wechat, remark, created_by, created_at, updated_at
		`, in.NameWechat, in.Remark, ac.UserID)
		if err := row.Scan(&v.ID, &v.NameWechat, &v.Remark, &v.CreatedBy, &v.CreatedAt, &v.UpdatedAt); err != nil {
			return fmt.Errorf("customer_service: insert customer: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return v, nil
}

// ============================================================
// Update
// ============================================================

// Update 部分字段更新客户。
//
// 业务流程：
//  1. assert sc / input 类型
//  2. InTx 注入 RLS GUC
//  3. 用 COALESCE 思路构造动态 UPDATE：仅传非 nil 字段进 SET 子句
//     RLS customers_update USING (is_admin OR created_by = me) 拦截无权用户
//  4. RETURNING 全部字段；0 行影响 → ErrCustomerNotFound
//
// 设计取舍：
//   - 用 COALESCE($1, name_wechat) 而不是动态拼 SET 列表：避免列名拼接的注入面，
//     代价是每次 UPDATE 都 SET 全部列（包括没变的），写放大可忽略
//   - Remark 是 **string：外层 nil = "不变"；内层 nil = "设为 NULL"；其它 = 设为该值
func (s *customerService) Update(ctx context.Context, sc SessionContext, id int64, input any) (any, error) {
	ac, ok := sc.(AuthContext)
	if !ok {
		return nil, ErrInvalidSessionContext
	}
	in, ok := input.(UpdateCustomerInput)
	if !ok {
		return nil, fmt.Errorf("customer_service: input must be UpdateCustomerInput, got %T", input)
	}
	// 业务校验：若显式提供 NameWechat 但是空字符串，拒绝
	if in.NameWechat != nil && *in.NameWechat == "" {
		return nil, ErrCustomerNameRequired
	}

	// remarkProvided=true 表示外层非 nil（要写入），remarkValue 是要写入的值（可为 nil = SQL NULL）
	remarkProvided := in.Remark != nil
	var remarkValue *string
	if remarkProvided {
		remarkValue = *in.Remark
	}

	var v CustomerView
	err := progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := progressdb.SetSessionContext(ctx, tx, ac.UserID, ac.RoleID); err != nil {
			return fmt.Errorf("customer_service: set session ctx: %w", err)
		}
		// 业务流程：
		//   $1 = name_wechat 候选（nil 时 COALESCE 回原值）
		//   $2 = remark 候选（**当且仅当 $3 = TRUE 时**生效；$3=FALSE 时保留原值）
		//   $3 = remark_provided：因为 remark 允许显式 NULL，无法用 COALESCE 区分"不变"与"设为 NULL"
		//   $4 = id
		row := tx.QueryRow(ctx, `
			UPDATE customers
			SET name_wechat = COALESCE($1, name_wechat),
			    remark      = CASE WHEN $3::BOOLEAN THEN $2 ELSE remark END,
			    updated_at  = NOW()
			WHERE id = $4
			RETURNING id, name_wechat, remark, created_by, created_at, updated_at
		`, in.NameWechat, remarkValue, remarkProvided, id)
		if err := row.Scan(&v.ID, &v.NameWechat, &v.Remark, &v.CreatedBy, &v.CreatedAt, &v.UpdatedAt); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrCustomerNotFound
			}
			return fmt.Errorf("customer_service: update customer: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return v, nil
}
