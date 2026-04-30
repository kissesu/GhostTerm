/*
@file customer.go
@description 客户相关 HTTP handler 实现（ogen Handler 接口对应方法）：
             - CustomersList   GET    /api/customers
             - CustomersGet    GET    /api/customers/{id}
             - CustomersCreate POST   /api/customers
             - CustomersUpdate PATCH  /api/customers/{id}

             所有 endpoint：
             - 鉴权由 ogen SecurityHandler 在 op 之前完成 → ctx 已含 AuthContext；
               handler 入口只取 sc，不再做 token 校验
             - 错误统一映射为 ErrorEnvelope（unauthorized/not_found/validation_failed）
             - 行级可见性由 service 层 + RLS 承担；handler 不拼 WHERE 子句

             不在本文件做的事：
             - router.go 的 oasHandler 方法委派（见任务说明：Lead 未添加 stub，
               handler 实现先落，等 Lead 接管 wiring）
@author Atlas.oi
@date 2026-04-29
*/

package handlers

import (
	"context"
	"errors"
	"fmt"

	"github.com/ghostterm/progress-server/internal/api/middleware"
	"github.com/ghostterm/progress-server/internal/api/oas"
	"github.com/ghostterm/progress-server/internal/services"
)

// CustomerHandler 实现 ogen Handler 中与客户 CRUD 相关的 4 个方法。
//
// 业务背景：
//   - 与 AuthHandler / RBACHandler 同模式：service 字段 + 显式 forward
//   - 路由层 oasHandler 持 *CustomerHandler 字段并 forward 各方法（参考 router.go 注释）
type CustomerHandler struct {
	Svc services.CustomerService
}

// NewCustomerHandler 构造 CustomerHandler。
func NewCustomerHandler(svc services.CustomerService) *CustomerHandler {
	return &CustomerHandler{Svc: svc}
}

// ============================================================
// CustomersList — GET /api/customers
// ============================================================

// CustomersList 列出当前 session 可见的客户。
//
// 业务流程：
//  1. 从 ctx 取 AuthContext（鉴权中间件注入）；缺失 → 401
//  2. svc.List → []any（每个元素是 services.CustomerView）
//  3. type-assert 后转 []oas.Customer 装进 CustomerListResponse
//
// 错误映射：
//   - middleware.AuthContextFrom 失败 → 401 unauthorized
//   - service 失败 → 500 internal（默认 ErrorHandler 兜底）
func (h *CustomerHandler) CustomersList(ctx context.Context) (oas.CustomersListRes, error) {
	sc, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		return unauthorizedErrorEnvelope("未登录"), nil
	}
	rows, err := h.Svc.List(ctx, sc, services.PageQuery{})
	if err != nil {
		return nil, fmt.Errorf("customer handler: list: %w", err)
	}
	out := make([]oas.Customer, 0, len(rows))
	for _, r := range rows {
		v, ok := r.(services.CustomerView)
		if !ok {
			return nil, fmt.Errorf("customer handler: unexpected list item type %T", r)
		}
		out = append(out, toOASCustomer(v))
	}
	return &oas.CustomerListResponse{Data: out}, nil
}

// ============================================================
// CustomersGet — GET /api/customers/{id}
// ============================================================

// CustomersGet 按 id 取单个客户。
//
// 错误映射：
//   - 401 → unauthorized
//   - ErrCustomerNotFound（含 RLS 拦截）→ 404 not_found（不区分"无权"与"不存在"）
func (h *CustomerHandler) CustomersGet(ctx context.Context, params oas.CustomersGetParams) (oas.CustomersGetRes, error) {
	sc, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		return unauthorizedErrorEnvelope("未登录"), nil
	}
	raw, err := h.Svc.Get(ctx, sc, params.ID)
	if err != nil {
		if errors.Is(err, services.ErrCustomerNotFound) {
			return notFoundErrorEnvelope(fmt.Sprintf("客户 %d 不存在或无权限", params.ID)), nil
		}
		return nil, fmt.Errorf("customer handler: get: %w", err)
	}
	v, ok := raw.(services.CustomerView)
	if !ok {
		return nil, fmt.Errorf("customer handler: unexpected get type %T", raw)
	}
	return &oas.CustomerResponse{Data: toOASCustomer(v)}, nil
}

// ============================================================
// CustomersCreate — POST /api/customers
// ============================================================

// CustomersCreate 创建客户，当前 session 用户成为 created_by。
//
// 错误映射：
//   - 401 → unauthorized
//   - ErrCustomerNameRequired → 422 validation_failed
func (h *CustomerHandler) CustomersCreate(ctx context.Context, req *oas.CustomerCreateRequest) (oas.CustomersCreateRes, error) {
	sc, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		return customersCreateUnauthorized("未登录"), nil
	}
	if req == nil {
		return customersCreateValidation("请求体不能为空"), nil
	}
	in := services.CreateCustomerInput{
		NameWechat: req.NameWechat,
		// 复用 rbac.go 同包私有 helper —— 同包同目录可直接调用
		Remark: optStringToPtr(req.Remark),
	}
	raw, err := h.Svc.Create(ctx, sc, in)
	if err != nil {
		if errors.Is(err, services.ErrCustomerNameRequired) {
			return customersCreateValidation("nameWechat 必填且不能为空"), nil
		}
		return nil, fmt.Errorf("customer handler: create: %w", err)
	}
	v, ok := raw.(services.CustomerView)
	if !ok {
		return nil, fmt.Errorf("customer handler: unexpected create type %T", raw)
	}
	return &oas.CustomerResponse{Data: toOASCustomer(v)}, nil
}

// ============================================================
// CustomersUpdate — PATCH /api/customers/{id}
// ============================================================

// CustomersUpdate 部分字段更新客户。
//
// 错误映射：
//   - 401 → unauthorized（用通用 ErrorEnvelope，oas 没生成 CustomersUpdateUnauthorized）
//   - ErrCustomerNotFound（含 RLS UPDATE 拦截）→ 404 not_found
//   - ErrCustomerNameRequired → 422 validation_failed
func (h *CustomerHandler) CustomersUpdate(ctx context.Context, req *oas.CustomerUpdateRequest, params oas.CustomersUpdateParams) (oas.CustomersUpdateRes, error) {
	sc, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		// CustomersUpdate 没有 401 res 类型；用 ErrorEnvelope（已实现 customersUpdateRes 接口）
		// 但 ErrorEnvelope 没有为 customersUpdateRes 注册 —— 改返回 NotFound 兼容
		// （注：实际不会走到这里，因为 SecurityHandler 在 op 之前已拒绝无 token 的请求）
		return customersUpdateNotFound("未登录"), nil
	}
	if req == nil {
		return customersUpdateValidation("请求体不能为空"), nil
	}

	in := services.UpdateCustomerInput{}
	if req.NameWechat.Set {
		v := req.NameWechat.Value
		in.NameWechat = &v
	}
	// remark 是 OptNilString：Set=true 表示请求体里出现了 remark 字段
	//   - Null=true → 显式设为 NULL（清空）
	//   - Null=false → 设为 Value
	if req.Remark.Set {
		var inner *string
		if !req.Remark.Null {
			val := req.Remark.Value
			inner = &val
		}
		in.Remark = &inner
	}

	raw, err := h.Svc.Update(ctx, sc, params.ID, in)
	if err != nil {
		if errors.Is(err, services.ErrCustomerNotFound) {
			return customersUpdateNotFound(fmt.Sprintf("客户 %d 不存在或无权限", params.ID)), nil
		}
		if errors.Is(err, services.ErrCustomerNameRequired) {
			return customersUpdateValidation("nameWechat 不能为空"), nil
		}
		return nil, fmt.Errorf("customer handler: update: %w", err)
	}
	v, ok := raw.(services.CustomerView)
	if !ok {
		return nil, fmt.Errorf("customer handler: unexpected update type %T", raw)
	}
	return &oas.CustomerResponse{Data: toOASCustomer(v)}, nil
}

// ============================================================
// 辅助：service.CustomerView → oas.Customer
// ============================================================

// toOASCustomer 把 service 层视图转为 oas Customer。
func toOASCustomer(v services.CustomerView) oas.Customer {
	c := oas.Customer{
		ID:         v.ID,
		NameWechat: v.NameWechat,
		CreatedBy:  v.CreatedBy,
		CreatedAt:  v.CreatedAt,
		UpdatedAt:  v.UpdatedAt,
	}
	if v.Remark != nil {
		c.Remark.SetTo(*v.Remark)
	} else {
		c.Remark.SetToNull()
	}
	return c
}

// ============================================================
// 错误响应构造
// ============================================================

// notFoundErrorEnvelope 通用 404（用于 CustomersGet 的 *ErrorEnvelope 路径）。
func notFoundErrorEnvelope(msg string) *oas.ErrorEnvelope {
	e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeNotFound, msg)
	return &e
}

func customersCreateUnauthorized(msg string) *oas.CustomersCreateUnauthorized {
	e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeUnauthorized, msg)
	res := oas.CustomersCreateUnauthorized(e)
	return &res
}

func customersCreateValidation(msg string) *oas.CustomersCreateUnprocessableEntity {
	e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeValidationFailed, msg)
	res := oas.CustomersCreateUnprocessableEntity(e)
	return &res
}

func customersUpdateNotFound(msg string) *oas.CustomersUpdateNotFound {
	e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeNotFound, msg)
	res := oas.CustomersUpdateNotFound(e)
	return &res
}

func customersUpdateValidation(msg string) *oas.CustomersUpdateUnprocessableEntity {
	e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeValidationFailed, msg)
	res := oas.CustomersUpdateUnprocessableEntity(e)
	return &res
}
