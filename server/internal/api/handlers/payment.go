/*
@file payment.go
@description 财务相关 HTTP handler 实现（ogen Handler 接口对应方法）：
             - ProjectsListPayments    GET  /api/projects/{id}/payments
             - ProjectsCreatePayment   POST /api/projects/{id}/payments

             实现要点：
             - 入参 oas.PaymentCreateRequest → services.PaymentCreateInput 适配
             - amount Money 类型转换：oas.Money(string) → db.Money
             - service ErrPaymentXxx 业务错误统一映射为 422 ValidationError ErrorEnvelope
             - 401 由 ogen SecurityHandler 在到达 handler 前已拦截；本 handler 兜底再做一次

             权限校验：
             - 端点级 perm 由 router 层中间件 RequirePerm("payment:create") 控制
             - 行级可见性由 RLS + project_members 兜底
             本 handler 不重复做 perm 检查，避免与中间件双重维护
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
	progressdb "github.com/ghostterm/progress-server/internal/db"
	"github.com/ghostterm/progress-server/internal/services"
)

// PaymentHandler 实现 ogen 生成的 oas.Handler 中与 payment 相关的 2 个方法。
//
// 业务背景：
//   - router.go 在 oasHandler 上挂 forward 方法，把请求转给本 handler
//   - 与 RBACHandler / AuthHandler 各自分文件，方便分 phase 并行开发
type PaymentHandler struct {
	Svc services.PaymentService
}

// NewPaymentHandler 构造 PaymentHandler。
func NewPaymentHandler(svc services.PaymentService) *PaymentHandler {
	return &PaymentHandler{Svc: svc}
}

// ============================================================
// ProjectsListPayments — GET /api/projects/{id}/payments
// ============================================================

// ProjectsListPayments 列出项目下全部 payment 流水。
//
// 业务流程：
//  1. 校验 AuthContext（路由 SecurityHandler 已拦 unauthorized；这里防御兜底）
//  2. 调 svc.List(projectID) 拿 []services.Payment
//  3. 转为 oas.PaymentListResponse 返回
//
// 错误映射：
//   - 缺 AuthContext → error（router.errorEnvelopeHandler 映射为 401）
//   - DB 错误 → error → 500
func (h *PaymentHandler) ProjectsListPayments(ctx context.Context, params oas.ProjectsListPaymentsParams) (*oas.PaymentListResponse, error) {
	ac, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		return nil, errors.New("payment handler: missing auth context")
	}

	raw, err := h.Svc.List(ctx, ac, params.ID)
	if err != nil {
		return nil, fmt.Errorf("payment handler: list: %w", err)
	}

	out := make([]oas.Payment, 0, len(raw))
	for _, item := range raw {
		p, ok := item.(services.Payment)
		if !ok {
			return nil, errors.New("payment handler: unexpected item type from service")
		}
		out = append(out, toOASPayment(p))
	}
	return &oas.PaymentListResponse{Data: out}, nil
}

// ============================================================
// ProjectsCreatePayment — POST /api/projects/{id}/payments
// ============================================================

// ProjectsCreatePayment 创建一条 payment 流水（收款 / 结算）。
//
// 业务流程：
//  1. 解析 AuthContext（recordedBy 从 ac.UserID 注入，前端不能伪造）
//  2. 把 oas.PaymentCreateRequest 转为 services.PaymentCreateInput
//     - oas.Money(string) → db.Money 走 MoneyFromString，拒绝 3+ 位小数
//     - OptNilInt64 → *int64 用 .Get() 读取
//  3. 调 svc.Create
//  4. 业务 sentinel error → 422 ErrorEnvelope（保持错误语义稳定）
//  5. 成功 → oas.PaymentResponse{Data: ...}
//
// 错误映射：
//   - ErrPaymentInvalidAmount / ErrPaymentInvalidDirection / ErrPaymentRemarkRequired /
//     ErrPaymentSettlementMissingFields → 422 validation_failed
//   - ErrPaymentProjectNotFound → 404 not_found（用 ErrorEnvelope，因 oas 无 404 specialized type）
//   - 其它（DB / 网络）→ 500（router.errorEnvelopeHandler 兜底）
func (h *PaymentHandler) ProjectsCreatePayment(
	ctx context.Context,
	req *oas.PaymentCreateRequest,
	params oas.ProjectsCreatePaymentParams,
) (oas.ProjectsCreatePaymentRes, error) {
	ac, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		return nil, errors.New("payment handler: missing auth context")
	}
	if req == nil {
		return paymentValidationError("请求体为空"), nil
	}

	// ============================================================
	// 第一步：oas → service 类型转换
	// ============================================================

	// Money: oas.Money 是 string 别名 → db.Money
	amount, err := progressdb.MoneyFromString(string(req.Amount))
	if err != nil {
		return paymentValidationError(fmt.Sprintf("amount 格式非法：%v", err)), nil
	}

	// OptNilInt64 → *int64
	relatedUserID := optNilInt64ToPtr(req.RelatedUserId)
	screenshotID := optNilInt64ToPtr(req.ScreenshotId)

	input := services.PaymentCreateInput{
		Direction:     services.PaymentDirection(req.Direction),
		Amount:        amount,
		PaidAt:        req.PaidAt,
		RelatedUserID: relatedUserID,
		ScreenshotID:  screenshotID,
		Remark:        req.Remark,
		RecordedBy:    ac.UserID, // 强制用当前登录用户，不允许前端伪造
	}

	// ============================================================
	// 第二步：调 service
	// ============================================================
	raw, err := h.Svc.Create(ctx, ac, params.ID, input)
	if err != nil {
		// 业务 sentinel 错误 → 422
		if errors.Is(err, services.ErrPaymentInvalidAmount) ||
			errors.Is(err, services.ErrPaymentInvalidDirection) ||
			errors.Is(err, services.ErrPaymentRemarkRequired) ||
			errors.Is(err, services.ErrPaymentSettlementMissingFields) {
			return paymentValidationError(err.Error()), nil
		}
		// 项目不存在 → 422（因 oas 该 op 仅声明 422，沿用同 envelope 编码 not_found）
		if errors.Is(err, services.ErrPaymentProjectNotFound) {
			e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeNotFound, err.Error())
			return &e, nil
		}
		return nil, fmt.Errorf("payment handler: create: %w", err)
	}

	p, ok := raw.(services.Payment)
	if !ok {
		return nil, errors.New("payment handler: unexpected payment type from service")
	}
	return &oas.PaymentResponse{Data: toOASPayment(p)}, nil
}

// ============================================================
// 辅助：service 层 → oas 层模型转换
// ============================================================

// toOASPayment 把 services.Payment 转为 oas.Payment。
//
// 业务背景：
//   - oas.Money 是 string 别名，走 db.Money.StringFixed(2) 输出固定 2 位小数
//   - related_user_id / screenshot_id 是 OptNilInt64：nil → 显式 SetToNull；
//     有值 → SetTo(*v)。前端拿到 null 而不是 omitted，方便 schema 校验
func toOASPayment(p services.Payment) oas.Payment {
	out := oas.Payment{
		ID:         p.ID,
		ProjectId:  p.ProjectID,
		Direction:  oas.PaymentDirection(p.Direction),
		Amount:     oas.Money(p.Amount.StringFixed(2)),
		PaidAt:     p.PaidAt,
		Remark:     p.Remark,
		RecordedBy: p.RecordedBy,
		RecordedAt: p.RecordedAt,
	}
	if p.RelatedUserID != nil {
		out.RelatedUserId.SetTo(*p.RelatedUserID)
	} else {
		out.RelatedUserId.SetToNull()
	}
	if p.ScreenshotID != nil {
		out.ScreenshotId.SetTo(*p.ScreenshotID)
	} else {
		out.ScreenshotId.SetToNull()
	}
	return out
}

// optNilInt64ToPtr 把 OptNilInt64 转为 *int64：未 set 或 null → nil；有值 → 指向该值。
func optNilInt64ToPtr(o oas.OptNilInt64) *int64 {
	v, ok := o.Get()
	if !ok {
		return nil
	}
	val := v
	return &val
}

// ============================================================
// 错误响应构造
// ============================================================

// paymentValidationError 构造 422 ErrorEnvelope。
//
// 业务背景：oas spec 中 ProjectsCreatePayment 的 422 引用 ValidationError 通用响应；
// 实际类型仍是 ErrorEnvelope，由 ogen response encoder 写为 HTTP 422 状态码。
func paymentValidationError(msg string) *oas.ErrorEnvelope {
	e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeValidationFailed, msg)
	return &e
}
