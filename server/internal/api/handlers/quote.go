/*
@file quote.go
@description 费用变更 HTTP handler —— Phase 8 Worker E。

             实现 ogen Handler 接口的两个方法：
             - ProjectsListQuoteChanges    GET  /api/projects/{id}/quote-changes
             - ProjectsCreateQuoteChange   POST /api/projects/{id}/quote-changes

             权限链（spec §7.3）：
             - 所有 endpoint 必须登录（AuthContext 在 ctx 中）→ 否则 401
             - Create 仅 客服(role_id=3) + 超管(role_id=1) 可调 → 其它角色 422 permission_denied
             - List 沿用 RLS：member / admin 可见，非成员得到空数组（不报 403）
                * 注：openapi.yaml 当前未给 list 声明 403 响应类型，
                  非成员用户走 RLS 看到的是空 list，与"看不见"语义一致

             错误映射：
             - validate 失败（reason 空 / delta 缺失 / 未知 type）→ 422 validation_failed
             - 项目不存在 / RLS 拦截更新 → 422 validation_failed (附 project_not_found message)
                * openapi.yaml POST 仅声明 201 + 422，service 的 not_found 也走 422 通道，
                  以 message 区分细类，避免引入 404 schema 漂移

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

// QuoteHandler 实现费用变更相关的 ogen Handler 方法。
type QuoteHandler struct {
	Svc *services.QuoteService
}

// NewQuoteHandler 构造 QuoteHandler。
func NewQuoteHandler(svc *services.QuoteService) *QuoteHandler {
	return &QuoteHandler{Svc: svc}
}

// 业务约定：客服(3) + 超管(1) 可创建费用变更（spec §7.3）。
// 当前 0001 migration 没有把 'quote_change' 资源加入 permissions 表，
// 用 roleID 白名单作为粗粒度门，待后续 migration 演进后切换到 HasPermission。
const (
	roleAdmin           int64 = 1
	roleCustomerService int64 = 3
)

// ============================================================
// ProjectsListQuoteChanges — GET /api/projects/{id}/quote-changes
// ============================================================

// ProjectsListQuoteChanges 列出项目的费用变更日志。
//
// RLS 行为：
//   - 非项目成员看到空 list（policy quote_changes_select 拦截）
//   - admin 看到全部
func (h *QuoteHandler) ProjectsListQuoteChanges(
	ctx context.Context,
	params oas.ProjectsListQuoteChangesParams,
) (*oas.QuoteChangeListResponse, error) {
	ac, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		// ogen 在 SecurityHandler 已经做 401，这里 fall through 是防御
		return nil, errors.New("unauthorized")
	}

	logs, err := h.Svc.ListChanges(ctx, ac, params.ID)
	if err != nil {
		return nil, fmt.Errorf("quote handler: list: %w", err)
	}

	out := make([]oas.QuoteChange, 0, len(logs))
	for _, l := range logs {
		out = append(out, toOASQuoteChange(l))
	}
	return &oas.QuoteChangeListResponse{Data: out}, nil
}

// ============================================================
// ProjectsCreateQuoteChange — POST /api/projects/{id}/quote-changes
// ============================================================

// ProjectsCreateQuoteChange 提交一条费用变更并原子更新项目报价。
//
// 业务流程：
//  1. AuthContext 校验：未登录 → 401（兜底，ogen 通常已拦下）
//  2. roleID 白名单：仅 admin/客服 → 否则 422 permission_denied（开发不可越权改报价）
//  3. 入参 → service DTO 转换：解 OptMoney + change_type 字符串
//  4. 调 svc.CreateChange：内部事务 + RLS + UPDATE projects + INSERT log
//  5. 错误映射：ErrQuoteValidation / ErrQuoteProjectNotFound → 422
func (h *QuoteHandler) ProjectsCreateQuoteChange(
	ctx context.Context,
	req *oas.QuoteChangeRequest,
	params oas.ProjectsCreateQuoteChangeParams,
) (oas.ProjectsCreateQuoteChangeRes, error) {
	ac, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		return nil, errors.New("unauthorized")
	}
	// roleID 白名单（spec §7.3）
	if ac.RoleID != roleAdmin && ac.RoleID != roleCustomerService {
		return validationErrorEnvelope("仅超管或客服可提交费用变更"), nil
	}
	if req == nil {
		return validationErrorEnvelope("缺少请求体"), nil
	}

	// ============================================
	// OAS Money(string) → service db.Money 转换
	// 拒绝 3+ 位小数（与 db.Money 的契约一致；前端也会先检查，但服务端必须独立校验）
	// ============================================
	var deltaPtr, newQuotePtr *progressdb.Money
	if v, set := req.Delta.Get(); set {
		m, err := progressdb.MoneyFromString(string(v))
		if err != nil {
			return validationErrorEnvelope("delta 金额格式无效（最多 2 位小数）"), nil
		}
		deltaPtr = &m
	}
	if v, set := req.NewQuote.Get(); set {
		m, err := progressdb.MoneyFromString(string(v))
		if err != nil {
			return validationErrorEnvelope("newQuote 金额格式无效（最多 2 位小数）"), nil
		}
		newQuotePtr = &m
	}

	in := services.QuoteChangeInput{
		ProjectID:  params.ID,
		ChangeType: services.QuoteChangeType(req.ChangeType),
		Delta:      deltaPtr,
		NewQuote:   newQuotePtr,
		Reason:     req.Reason,
		ChangedBy:  ac.UserID,
		RoleID:     ac.RoleID,
	}

	log, err := h.Svc.CreateChange(ctx, ac, in)
	if err != nil {
		switch {
		case errors.Is(err, services.ErrQuoteValidation):
			return validationErrorEnvelope(err.Error()), nil
		case errors.Is(err, services.ErrQuoteProjectNotFound):
			return validationErrorEnvelope("项目不存在或无权访问"), nil
		default:
			return nil, fmt.Errorf("quote handler: create: %w", err)
		}
	}

	resp := toOASQuoteChange(*log)
	return &oas.QuoteChangeResponse{Data: resp}, nil
}

// ============================================================
// 辅助：service → oas 模型转换
// ============================================================

// toOASQuoteChange 把 service 层 QuoteChangeLog 转 oas QuoteChange。
//
// Money 字段：service 的 db.Money 通过 StringFixed(2) 落 oas.Money(string)，
// JSON 序列化保持 "123.45" 形态（与 OpenAPI Money pattern 对齐）。
func toOASQuoteChange(l services.QuoteChangeLog) oas.QuoteChange {
	return oas.QuoteChange{
		ID:         l.ID,
		ProjectId:  l.ProjectID,
		ChangeType: oas.QuoteChangeType(l.ChangeType),
		Delta:      oas.Money(l.Delta.StringFixed(2)),
		OldQuote:   oas.Money(l.OldQuote.StringFixed(2)),
		NewQuote:   oas.Money(l.NewQuote.StringFixed(2)),
		Reason:     l.Reason,
		Phase:      oas.ProjectStatus(l.Phase),
		ChangedBy:  l.ChangedBy,
		ChangedAt:  l.ChangedAt,
	}
}

// validationErrorEnvelope 构造 422 ProjectsCreateQuoteChange 错误响应。
//
// 业务背景：
//   - openapi.yaml 中 POST /quote-changes 仅声明 201 + 422 两种响应
//   - 422 schema = ValidationError（共享 ErrorEnvelope）
//   - oas 包给 ProjectsCreateQuoteChangeRes 接口的实现是 *ErrorEnvelope（projectsCreateQuoteChangeRes 方法）
func validationErrorEnvelope(msg string) *oas.ErrorEnvelope {
	e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeValidationFailed, msg)
	return &e
}
