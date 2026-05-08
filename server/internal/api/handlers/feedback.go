/*
@file feedback.go
@description 反馈相关 HTTP handler 实现（Phase 7 Worker D，对应 ogen 生成的 3 个方法）：
             - ProjectsListFeedbacks   GET    /api/projects/{id}/feedbacks
             - ProjectsCreateFeedback  POST   /api/projects/{id}/feedbacks
             - FeedbacksUpdate         PATCH  /api/feedbacks/{id}

             业务背景：
             - 这三个方法当前在 oas.UnimplementedHandler 默认返回 ErrNotImplemented；
               router.go 将通过 oasHandler 嵌入 *FeedbackHandler 字段并 forward 来覆盖默认实现
               （router 层接线由 Lead 完成；本 handler 仅提供方法实现，不直接修改 router.go）

             权限校验（finding #16 修复 / 2026-05-08）：
             - 改走 EffectivePermissionsService.Compute 链路（ctx 已由 oasSecurityHandler
               预填 effective perms），与 PermissionsHandler.checkPerm 同 pattern；
               legacy RBACService.HasPermission 用的是 2 段 code（resource:action），
               不读 user_permissions 表，超管 deny 某用户的 feedback:create 不生效
             - 3 个 endpoint 校验码：
                 List   → progress:feedback:list
                 Create → progress:feedback:create
                 Update → progress:feedback:update（0024 migration 新增）
             - super_admin 通过 EffectivePermissionsService 返回的 *:* 哨兵自动放行

             错误映射：
             - ErrFeedbackContentEmpty / ErrFeedbackInvalidSource / ErrFeedbackInvalidStatus
               → 422 validation_failed
             - ErrFeedbackNotFound → 404 not_found
             - 其它 → 500（由 router.errorEnvelopeHandler 兜底）
@author Atlas.oi
@date 2026-04-29 (2026-05-08 finding #16 修复：切到 EffectivePermissionsService)
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

// 权限码常量。3 段格式 resource:action:scope，与 0007/0024 migration permissions 表对齐。
//
// 与 EffectivePermissionsService 输出格式一致；MatchPermission 在 *:* / resource:action:* /
// resource:*:* / exact 四档优先级匹配，super_admin 通过 *:* 哨兵自动放行。
const (
	permFeedbackList   = "progress:feedback:list"
	permFeedbackCreate = "progress:feedback:create"
	permFeedbackUpdate = "progress:feedback:update"
)

// FeedbackHandler 实现 ogen 生成 oas.Handler 中与 feedback 相关的 3 个方法。
//
// finding #16 修复后字段：
//   - Svc：FeedbackService 业务实现（不变）
//   - RBAC：保留 RBACService 引用以兼容老接口（CanTriggerEvent 等暂未迁移路径），
//     但权限码校验不再走它，改走 effectivePerms（读 user_permissions 覆写表）
//   - effectivePerms：用于在测试 / 兼容场景手动算 effective perms；
//     生产路径走 ctx 中已预填的 perms（oasSecurityHandler 在鉴权时填好）
type FeedbackHandler struct {
	Svc            services.FeedbackService
	RBAC           services.RBACService
	effectivePerms services.EffectivePermissionsService
}

// NewFeedbackHandler 构造 FeedbackHandler。
//
// 业务背景：三个依赖必填 —— svc 业务、rbac 兼容老路径、effectivePerms 是 finding #16
// 修复后真正的权限校验源。缺失时返回 error，让 router 启动时立即暴露配置漂移，
// 而不是运行时 nil deref。
func NewFeedbackHandler(svc services.FeedbackService, rbac services.RBACService, effectivePerms services.EffectivePermissionsService) (*FeedbackHandler, error) {
	if svc == nil {
		return nil, errors.New("feedback handler: svc is required")
	}
	if rbac == nil {
		return nil, errors.New("feedback handler: rbac is required")
	}
	if effectivePerms == nil {
		return nil, errors.New("feedback handler: effectivePerms is required")
	}
	return &FeedbackHandler{Svc: svc, RBAC: rbac, effectivePerms: effectivePerms}, nil
}

// ============================================================
// 共享 helper：取 AuthContext + 校验权限码
// ============================================================

// requirePerm 从 ctx 取 AuthContext + effective perms，并按四档优先级判定 perm。
//
// finding #16 修复后实现：
//   - perms 由 oasSecurityHandler 在鉴权同时调 EffectivePermissionsService.Compute 注入
//     到 ctx，不再每次调 RBACService.HasPermission（不读 user_permissions 覆写表）
//   - 当 ctx 没挂 effective perms（理论上不可能；保留是兜底）退化为"无权"
//   - super_admin 通过 perms = ["*:*"] 哨兵自动放行（MatchPermission 内部已实现）
//
// 三个 endpoint 的错误响应 *Type 各不相同（ogen 生成），所以本函数只返回
// "通过/未通过" 两态，调用方各自构造对应类型的错误响应。
func (h *FeedbackHandler) requirePerm(ctx context.Context, perm string) (services.AuthContext, bool, error) {
	ac, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		return services.AuthContext{}, false, nil
	}
	perms, ok := middleware.EffectivePermsFrom(ctx)
	if !ok {
		// 没经 oasSecurityHandler 注入；按 fail-closed 原则当无权处理
		return ac, false, nil
	}
	return ac, middleware.MatchPermission(perms, perm), nil
}

// ============================================================
// ProjectsListFeedbacks — GET /api/projects/{id}/feedbacks
// ============================================================

// ProjectsListFeedbacks 列出项目下所有反馈（按 recorded_at ASC）。
//
// 注：oas 生成的签名直接返回 *FeedbackListResponse + error，没有 401/403 分支；
// 鉴权失败由 ogen SecurityHandler / errorEnvelopeHandler 在外层兜底返回 401。
// 这里 list 拿不到权限就退化为空列表（RLS 也会自然过滤为空），保持与无权时的语义一致。
func (h *FeedbackHandler) ProjectsListFeedbacks(ctx context.Context, params oas.ProjectsListFeedbacksParams) (*oas.FeedbackListResponse, error) {
	ac, allowed, err := h.requirePerm(ctx, permFeedbackList)
	if err != nil {
		return nil, err
	}
	if !allowed {
		// 权限缺失 → 返回空数组（RLS 也会过滤），保持 schema 不变
		return &oas.FeedbackListResponse{Data: []oas.Feedback{}}, nil
	}

	rawList, err := h.Svc.List(ctx, ac, params.ID)
	if err != nil {
		return nil, fmt.Errorf("feedback handler: list: %w", err)
	}
	out := make([]oas.Feedback, 0, len(rawList))
	for _, raw := range rawList {
		fb, ok := raw.(services.Feedback)
		if !ok {
			return nil, errors.New("feedback handler: unexpected feedback type from service")
		}
		out = append(out, toOASFeedback(fb))
	}
	return &oas.FeedbackListResponse{Data: out}, nil
}

// ============================================================
// ProjectsCreateFeedback — POST /api/projects/{id}/feedbacks
// ============================================================

// ProjectsCreateFeedback 录入反馈。
//
// 业务流程：
//  1. 鉴权 + 权限码 feedback:create
//  2. 解析 oas.FeedbackCreateRequest → services.CreateFeedbackInput
//     （source 是 OptFeedbackSource，未传时传 "" 让 service 走 DB DEFAULT）
//  3. 调 Svc.Create；ErrFeedbackContentEmpty/InvalidSource → 422，其它 → 500
//  4. 转 services.Feedback → oas.Feedback 返回 201
func (h *FeedbackHandler) ProjectsCreateFeedback(ctx context.Context, req *oas.FeedbackCreateRequest, params oas.ProjectsCreateFeedbackParams) (oas.ProjectsCreateFeedbackRes, error) {
	if req == nil {
		return feedbackCreateValidationError("请求体不能为空"), nil
	}
	ac, allowed, err := h.requirePerm(ctx, permFeedbackCreate)
	if err != nil {
		return nil, err
	}
	if !allowed {
		// oas 该 endpoint 错误响应仅含 422 一种，403 走 router 层兜底；
		// 这里把权限不足也用 422 + 自定义 message 表达
		return feedbackCreateValidationError("无创建反馈权限"), nil
	}

	// 解析可选 source
	source := ""
	if v, ok := req.Source.Get(); ok {
		source = string(v)
	}
	in := services.CreateFeedbackInput{
		Content:       req.Content,
		Source:        source,
		AttachmentIDs: req.AttachmentIds,
	}

	rawF, err := h.Svc.Create(ctx, ac, params.ID, in)
	if err != nil {
		switch {
		case errors.Is(err, services.ErrFeedbackContentEmpty):
			return feedbackCreateValidationError("content 必填"), nil
		case errors.Is(err, services.ErrFeedbackInvalidSource):
			return feedbackCreateValidationError("source 取值不在 phone/wechat/email/meeting/other 内"), nil
		}
		return nil, fmt.Errorf("feedback handler: create: %w", err)
	}
	fb, ok := rawF.(services.Feedback)
	if !ok {
		return nil, errors.New("feedback handler: unexpected feedback type from service")
	}
	return &oas.FeedbackResponse{Data: toOASFeedback(fb)}, nil
}

// ============================================================
// FeedbacksUpdate — PATCH /api/feedbacks/{id}
// ============================================================

// FeedbacksUpdate 修改反馈状态（pending → done / done → pending）。
//
// 业务流程：
//  1. 鉴权 + 权限码 feedback:create（v1 等价 update，见文件头注释）
//  2. 校验 req.status 必须显式传入；空 → 422
//  3. 调 Svc.UpdateStatus；ErrFeedbackNotFound → 404，ErrFeedbackInvalidStatus → 422
//  4. 转 services.Feedback → oas.Feedback 返回 200
func (h *FeedbackHandler) FeedbacksUpdate(ctx context.Context, req *oas.FeedbackUpdateRequest, params oas.FeedbacksUpdateParams) (oas.FeedbacksUpdateRes, error) {
	if req == nil {
		return feedbackUpdateNotFound("请求体不能为空"), nil
	}
	ac, allowed, err := h.requirePerm(ctx, permFeedbackUpdate)
	if err != nil {
		return nil, err
	}
	if !allowed {
		// 该 endpoint 错误响应仅含 404；权限不足也用 404 通用 envelope 兜底
		return feedbackUpdateNotFound("无修改反馈权限"), nil
	}

	statusVal, ok := req.Status.Get()
	if !ok {
		return feedbackUpdateNotFound("status 字段必填"), nil
	}

	rawF, err := h.Svc.UpdateStatus(ctx, ac, params.ID, string(statusVal))
	if err != nil {
		switch {
		case errors.Is(err, services.ErrFeedbackNotFound):
			return feedbackUpdateNotFound(fmt.Sprintf("反馈 %d 不存在", params.ID)), nil
		case errors.Is(err, services.ErrFeedbackInvalidStatus):
			return feedbackUpdateNotFound("status 取值非法（仅 pending / done）"), nil
		}
		return nil, fmt.Errorf("feedback handler: update status: %w", err)
	}
	fb, ok := rawF.(services.Feedback)
	if !ok {
		return nil, errors.New("feedback handler: unexpected feedback type from service")
	}
	return &oas.FeedbackResponse{Data: toOASFeedback(fb)}, nil
}

// ============================================================
// 辅助：service.Feedback → oas.Feedback
// ============================================================

// toOASFeedback 把 services.Feedback 转为 oas.Feedback。
//
// 注：
//   - oas.Feedback.AttachmentIds 是非 nullable []int64（required），即便没有附件也要给 [] 而非 nil
//     避免前端 zod schema 解析炸
//   - oas.Feedback.Attachments 同样是 required（用户反馈 2026-05-03 新增），no-attachment 时给 []
//     让前端可直接 .map 渲染 MediaPreview / 下载链接
func toOASFeedback(f services.Feedback) oas.Feedback {
	atts := f.AttachmentIDs
	if atts == nil {
		atts = []int64{}
	}
	// 映射 services.FeedbackAttachmentRef → oas.FeedbackAttachmentsItem
	attachments := make([]oas.FeedbackAttachmentsItem, 0, len(f.Attachments))
	for _, a := range f.Attachments {
		attachments = append(attachments, oas.FeedbackAttachmentsItem{
			ID:       a.ID,
			Filename: a.Filename,
		})
	}
	return oas.Feedback{
		ID:            f.ID,
		ProjectId:     f.ProjectID,
		Content:       f.Content,
		Source:        oas.FeedbackSource(f.Source),
		Status:        oas.FeedbackStatus(f.Status),
		RecordedBy:    f.RecordedBy,
		RecordedAt:    f.RecordedAt,
		AttachmentIds: atts,
		Attachments:   attachments,
	}
}

// ============================================================
// 错误响应构造
// ============================================================

// feedbackCreateValidationError 构造 422 错误（ProjectsCreateFeedback 唯一错误响应类型）。
func feedbackCreateValidationError(msg string) *oas.ErrorEnvelope {
	e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeValidationFailed, msg)
	return &e
}

// feedbackUpdateNotFound 构造 404 错误（FeedbacksUpdate 唯一错误响应类型）。
func feedbackUpdateNotFound(msg string) *oas.ErrorEnvelope {
	e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeNotFound, msg)
	return &e
}
