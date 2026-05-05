/*
@file project.go
@description 项目相关 HTTP handler 实现（ogen Handler 接口对应方法）：
             - ProjectsList   GET    /api/projects           （含 status filter）
             - ProjectsCreate POST   /api/projects
             - ProjectsGet    GET    /api/projects/{id}
             - ProjectsUpdate PATCH  /api/projects/{id}
             - ProjectsTriggerEvent POST /api/projects/{id}/events
             - ProjectsStatusChanges GET /api/projects/{id}/status-changes

             业务约定：
             - service 层负责 RLS / 状态机 / 事务原子性；handler 层只做：
               1. 从 ctx 拿 AuthContext
               2. OAS 入参 → service DTO 转换
               3. service 返回 → OAS 响应转换
               4. service sentinel error → ErrorEnvelope 响应映射

             错误映射表：
             - ErrProjectNotFound          → 404 not_found
             - ErrProjectPermissionDenied  → 403 permission_denied（OAS 用 401）
             - ErrProjectInvalidInput      → 422 validation_failed
             - statemachine.ErrInvalidStateTransition / ErrInvalidHolder
                                           → 409 state_machine_invalid_transition
             - services.ErrCancelPermissionDenied / statemachine.ErrUnknownEvent
                                           → 422 validation_failed
             - statemachine.ErrRemarkRequired / ErrNoCancelHistory
                                           → 422 validation_failed

             路由装配：本 handler 由 Lead 负责在 router.go 中 forward 到 oasHandler。
             worker B 不直接修改 router.go（owner = Lead）。
@author Atlas.oi
@date 2026-04-29
*/

package handlers

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ghostterm/progress-server/internal/api/middleware"
	"github.com/ghostterm/progress-server/internal/api/oas"
	progressdb "github.com/ghostterm/progress-server/internal/db"
	"github.com/ghostterm/progress-server/internal/services"
	"github.com/ghostterm/progress-server/internal/services/statemachine"
)

// ProjectHandler 实现 ogen 生成的 oas.Handler 中与项目相关的方法。
type ProjectHandler struct {
	Svc            *services.ProjectServiceImpl
	EffectivePerms services.EffectivePermissionsService
}

// NewProjectHandler 构造 ProjectHandler。
//
// EffectivePerms 用于细粒度权限校验（E12/E13 取消 + E_AS1 售后启动等 holder=nil 类事件）。
// 必须非 nil；router wiring 已构造 effSvc 传入。nil 会导致 cancel/after_sales 权限被跳过 →
// API 越权，故启动期 panic 拦住配置错误。
func NewProjectHandler(svc *services.ProjectServiceImpl, effSvc services.EffectivePermissionsService) *ProjectHandler {
	if effSvc == nil {
		panic("NewProjectHandler: EffectivePerms is required (nil 会导致权限校验被跳过)")
	}
	return &ProjectHandler{Svc: svc, EffectivePerms: effSvc}
}

// ============================================================
// ProjectsList — GET /api/projects
// ============================================================

// ProjectsList 返回当前用户可见的所有项目（RLS 已过滤）。
func (h *ProjectHandler) ProjectsList(ctx context.Context, params oas.ProjectsListParams) (oas.ProjectsListRes, error) {
	ac, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		return projectListErrUnauthorized("未登录"), nil
	}

	var statusFilter *oas.ProjectStatus
	if params.Status.IsSet() {
		s := params.Status.Value
		statusFilter = &s
	}

	projects, err := h.Svc.List(ctx, ac.UserID, ac.RoleID, statusFilter)
	if err != nil {
		return nil, fmt.Errorf("project handler: list: %w", err)
	}

	out := make([]oas.Project, 0, len(projects))
	for _, p := range projects {
		out = append(out, projectToOAS(p))
	}
	return &oas.ProjectListResponse{Data: out}, nil
}

// ============================================================
// ProjectsCreate — POST /api/projects
// ============================================================

// ProjectsCreate 创建项目（仅 admin / cs 可调）。
func (h *ProjectHandler) ProjectsCreate(ctx context.Context, req *oas.ProjectCreateRequest) (oas.ProjectsCreateRes, error) {
	ac, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeUnauthorized, "未登录")
		res := oas.ProjectsCreateUnauthorized(e)
		return &res, nil
	}

	in, err := oasCreateToInput(req)
	if err != nil {
		e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeValidationFailed, err.Error())
		res := oas.ProjectsCreateUnprocessableEntity(e)
		return &res, nil
	}

	p, err := h.Svc.Create(ctx, ac.UserID, ac.RoleID, in)
	if err != nil {
		switch {
		case errors.Is(err, services.ErrProjectInvalidInput):
			e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeValidationFailed, err.Error())
			res := oas.ProjectsCreateUnprocessableEntity(e)
			return &res, nil
		case errors.Is(err, services.ErrProjectPermissionDenied):
			e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeUnauthorized, err.Error())
			res := oas.ProjectsCreateUnauthorized(e)
			return &res, nil
		}
		return nil, fmt.Errorf("project handler: create: %w", err)
	}
	resp := oas.ProjectResponse{Data: projectToOAS(p)}
	return &resp, nil
}

// ============================================================
// ProjectsGet — GET /api/projects/{id}
// ============================================================

func (h *ProjectHandler) ProjectsGet(ctx context.Context, params oas.ProjectsGetParams) (oas.ProjectsGetRes, error) {
	ac, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		// ProjectsGetRes 没有 401，使用通用 ErrorEnvelope（401 由 router 兜底）
		return nil, errors.New("project handler: missing auth context")
	}

	p, err := h.Svc.Get(ctx, ac.UserID, ac.RoleID, params.ID)
	if err != nil {
		if errors.Is(err, services.ErrProjectNotFound) {
			e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeNotFound, "项目不存在或无权访问")
			return &e, nil
		}
		return nil, fmt.Errorf("project handler: get: %w", err)
	}
	return &oas.ProjectResponse{Data: projectToOAS(p)}, nil
}

// ============================================================
// ProjectsUpdate — PATCH /api/projects/{id}
// ============================================================

func (h *ProjectHandler) ProjectsUpdate(ctx context.Context, req *oas.ProjectUpdateRequest, params oas.ProjectsUpdateParams) (oas.ProjectsUpdateRes, error) {
	ac, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		return nil, errors.New("project handler: missing auth context")
	}

	in := oasUpdateToInput(req)
	p, err := h.Svc.Update(ctx, ac.UserID, ac.RoleID, params.ID, in)
	if err != nil {
		switch {
		case errors.Is(err, services.ErrProjectNotFound):
			e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeNotFound, "项目不存在或无权访问")
			res := oas.ProjectsUpdateNotFound(e)
			return &res, nil
		case errors.Is(err, services.ErrProjectInvalidInput):
			e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeValidationFailed, err.Error())
			res := oas.ProjectsUpdateUnprocessableEntity(e)
			return &res, nil
		}
		return nil, fmt.Errorf("project handler: update: %w", err)
	}
	return &oas.ProjectResponse{Data: projectToOAS(p)}, nil
}

// ============================================================
// ProjectsTriggerEvent — POST /api/projects/{id}/events
// ============================================================

func (h *ProjectHandler) ProjectsTriggerEvent(ctx context.Context, req *oas.EventTriggerRequest, params oas.ProjectsTriggerEventParams) (oas.ProjectsTriggerEventRes, error) {
	ac, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		return nil, errors.New("project handler: missing auth context")
	}

	// E12/E13/E_AS1 是 holder=nil 类事件，需细粒度权限码兜底（dev 默认无权，仅 admin/cs 有）：
	//   - E12 取消 / E13 重启取消 → progress:project:cancel
	//   - E_AS1 客户报售后 → progress:project:after_sales（archived 终态 holder=nil，无 holder 校验可走）
	// 业务背景（2026-05-04 决策）：删 AllowedRoleIDs 双层守门后，FromHolderRole=nil 的事件
	// 必须由权限码兜底，避免任何登录用户对 archived 项目越权挑起售后流。
	var permCode string
	switch req.Event {
	case oas.EventCodeE12, oas.EventCodeE13:
		permCode = "progress:project:cancel"
	case oas.EventCodeEAS1:
		permCode = "progress:project:after_sales"
	}
	if permCode != "" {
		if err := h.checkPermission(ctx, ac.UserID, permCode); err != nil {
			if errors.Is(err, services.ErrCancelPermissionDenied) {
				e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodePermissionDenied, "无操作权限")
				res := oas.ProjectsTriggerEventUnprocessableEntity(e)
				return &res, nil
			}
			return nil, fmt.Errorf("project handler: check perm: %w", err)
		}
	}

	if req.Remark == "" {
		e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeValidationFailed, "remark is required")
		res := oas.ProjectsTriggerEventUnprocessableEntity(e)
		return &res, nil
	}

	var newHolder *int64
	if v, ok := req.NewHolderUserId.Get(); ok {
		newHolder = &v
	}

	p, err := h.Svc.TriggerEvent(ctx, ac.UserID, ac.RoleID, params.ID, req.Event, req.Remark, newHolder)
	if err != nil {
		switch {
		case errors.Is(err, services.ErrProjectNotFound):
			e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeNotFound, "项目不存在或无权访问")
			// ProjectsTriggerEventRes 无 404 分支，用 409 转译为状态机不允许
			res := oas.ProjectsTriggerEventConflict(e)
			return &res, nil
		case errors.Is(err, statemachine.ErrInvalidStateTransition),
			errors.Is(err, statemachine.ErrInvalidHolder):
			e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeStateMachineInvalidTransition, err.Error())
			res := oas.ProjectsTriggerEventConflict(e)
			return &res, nil
		case errors.Is(err, services.ErrCancelPermissionDenied):
			e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodePermissionDenied, "无取消项目权限")
			res := oas.ProjectsTriggerEventUnprocessableEntity(e)
			return &res, nil
		case errors.Is(err, statemachine.ErrUnknownEvent),
			errors.Is(err, statemachine.ErrRemarkRequired),
			errors.Is(err, statemachine.ErrNoCancelHistory):
			e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeValidationFailed, err.Error())
			res := oas.ProjectsTriggerEventUnprocessableEntity(e)
			return &res, nil
		}
		return nil, fmt.Errorf("project handler: trigger event: %w", err)
	}
	return &oas.ProjectResponse{Data: projectToOAS(p)}, nil
}

// ============================================================
// ProjectsStatusChanges — GET /api/projects/{id}/status-changes
// ============================================================

func (h *ProjectHandler) ProjectsStatusChanges(ctx context.Context, params oas.ProjectsStatusChangesParams) (oas.ProjectsStatusChangesRes, error) {
	ac, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		return nil, errors.New("project handler: missing auth context")
	}

	logs, err := h.Svc.ListStatusChanges(ctx, ac.UserID, ac.RoleID, params.ID)
	if err != nil {
		if errors.Is(err, services.ErrProjectNotFound) {
			e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeNotFound, "项目不存在或无权访问")
			return &e, nil
		}
		return nil, fmt.Errorf("project handler: status changes: %w", err)
	}
	out := make([]oas.StatusChangeLog, 0, len(logs))
	for _, l := range logs {
		out = append(out, statusChangeToOAS(l))
	}
	return &oas.StatusChangeLogListResponse{Data: out}, nil
}

// ============================================================
// 辅助：DTO 转换
// ============================================================

// projectToOAS service.ProjectModel → oas.Project。
func projectToOAS(p *services.ProjectModel) oas.Project {
	// developers: service ref → oas.ProjectDeveloperRef
	devs := make([]oas.ProjectDeveloperRef, 0, len(p.Developers))
	for _, d := range p.Developers {
		devs = append(devs, oas.ProjectDeveloperRef{
			ID:          d.ID,
			DisplayName: d.DisplayName,
		})
	}
	out := oas.Project{
		ID:              p.ID,
		Name:            p.Name,
		CustomerLabel:   p.CustomerLabel,
		Description:     p.Description,
		Priority:        p.Priority,
		Status:          p.Status,
		Deadline:        p.Deadline,
		QuotingAt:       p.QuotingAt,
		OriginalQuote:   moneyToOAS(p.OriginalQuote),
		CurrentQuote:    moneyToOAS(p.CurrentQuote),
		AfterSalesTotal: moneyToOAS(p.AfterSalesTotal),
		TotalReceived:   moneyToOAS(p.TotalReceived),
		CreatedBy:       p.CreatedBy,
		CreatedAt:       p.CreatedAt,
		UpdatedAt:       p.UpdatedAt,
		Developers:      devs,
	}
	if p.ThesisLevel != nil {
		out.ThesisLevel.SetTo(*p.ThesisLevel)
	} else {
		out.ThesisLevel.SetToNull()
	}
	if p.Subject != nil {
		out.Subject.SetTo(*p.Subject)
	} else {
		out.Subject.SetToNull()
	}
	if p.HolderRoleID != nil {
		out.HolderRoleId.SetTo(*p.HolderRoleID)
	} else {
		out.HolderRoleId.SetToNull()
	}
	if p.HolderUserID != nil {
		out.HolderUserId.SetTo(*p.HolderUserID)
	} else {
		out.HolderUserId.SetToNull()
	}
	setOptDateTime(&out.DevStartedAt, p.DevStartedAt)
	setOptDateTime(&out.ConfirmingAt, p.ConfirmingAt)
	setOptDateTime(&out.DeliveredAt, p.DeliveredAt)
	setOptDateTime(&out.PaidAt, p.PaidAt)
	setOptDateTime(&out.ArchivedAt, p.ArchivedAt)
	setOptDateTime(&out.AfterSalesAt, p.AfterSalesAt)
	setOptDateTime(&out.CancelledAt, p.CancelledAt)
	setOptInt64(&out.OpeningDocId, p.OpeningDocID)
	setOptInt64(&out.AssignmentDocId, p.AssignmentDocID)
	setOptInt64(&out.FormatSpecDocId, p.FormatSpecDocID)
	return out
}

// statusChangeToOAS service.StatusChangeLogModel → oas.StatusChangeLog。
//
// 注：OAS schema 的 fromHolderId / toHolderId 是单一 int64，本服务记录的是
// holder_user_id（spec §6.5 决策；UI 只关心"谁是当时的持球人"，role 由 UI 反查）。
func statusChangeToOAS(l *services.StatusChangeLogModel) oas.StatusChangeLog {
	out := oas.StatusChangeLog{
		ID:          l.ID,
		ProjectId:   l.ProjectID,
		EventCode:   l.EventCode,
		EventName:   l.EventName,
		ToStatus:    l.ToStatus,
		Remark:      l.Remark,
		TriggeredBy: l.TriggeredBy,
		TriggeredAt: l.TriggeredAt,
	}
	if l.FromStatus != nil {
		out.FromStatus.SetTo(*l.FromStatus)
	} else {
		out.FromStatus.SetToNull()
	}
	if l.FromHolderUserID != nil {
		out.FromHolderId.SetTo(*l.FromHolderUserID)
	} else {
		out.FromHolderId.SetToNull()
	}
	if l.ToHolderUserID != nil {
		out.ToHolderId.SetTo(*l.ToHolderUserID)
	} else {
		out.ToHolderId.SetToNull()
	}
	return out
}

// oasCreateToInput OAS 入参 → service input。
func oasCreateToInput(req *oas.ProjectCreateRequest) (services.CreateProjectInput, error) {
	in := services.CreateProjectInput{
		Name:          req.Name,
		CustomerLabel: req.CustomerLabel,
		Description:   req.Description,
		Deadline:      req.Deadline,
	}
	if v, ok := req.Priority.Get(); ok {
		in.Priority = v
	}
	if v, ok := req.ThesisLevel.Get(); ok {
		in.ThesisLevel = &v
	}
	if v, ok := req.Subject.Get(); ok {
		in.Subject = &v
	}
	// OriginalQuote 默认 0；req.OriginalQuote 是 OptMoney（string-based）
	if v, ok := req.OriginalQuote.Get(); ok {
		m, err := progressdb.MoneyFromString(string(v))
		if err != nil {
			return in, fmt.Errorf("originalQuote 格式非法: %w", err)
		}
		in.OriginalQuote = m
	} else {
		in.OriginalQuote, _ = progressdb.MoneyFromString("0")
	}
	// 资料文件：openingDocId / assignmentDocId 是 OptNilInt64（既支持 unset 也支持 null）。
	// 仅在 IsSet 且非 Null 时透传 ID；其它情况留空让 DB 写 NULL。
	if req.OpeningDocId.IsSet() && !req.OpeningDocId.IsNull() {
		v := req.OpeningDocId.Value
		in.OpeningDocID = &v
	}
	if req.AssignmentDocId.IsSet() && !req.AssignmentDocId.IsNull() {
		v := req.AssignmentDocId.Value
		in.AssignmentDocID = &v
	}
	if len(req.WechatChatFileIds) > 0 {
		in.WechatChatFileIDs = append(in.WechatChatFileIDs, req.WechatChatFileIds...)
	}
	// 项目对接的开发人员（必填，至少 1 个；service 层兜底校验）
	if len(req.DeveloperUserIds) > 0 {
		in.DeveloperUserIDs = append(in.DeveloperUserIDs, req.DeveloperUserIds...)
	}
	return in, nil
}

// oasUpdateToInput OAS PATCH 入参 → service update input。
func oasUpdateToInput(req *oas.ProjectUpdateRequest) services.UpdateProjectInput {
	in := services.UpdateProjectInput{}
	if v, ok := req.Name.Get(); ok {
		in.Name = &v
	}
	if v, ok := req.CustomerLabel.Get(); ok {
		in.CustomerLabel = &v
	}
	if v, ok := req.Description.Get(); ok {
		in.Description = &v
	}
	if v, ok := req.Priority.Get(); ok {
		in.Priority = &v
	}
	if v, ok := req.ThesisLevel.Get(); ok {
		in.ThesisLevel = &v
	}
	// Subject: nullable —— Set + Null=true 表示清空
	if req.Subject.IsSet() {
		if req.Subject.IsNull() {
			in.ClearSubject = true
		} else {
			v := req.Subject.Value
			in.Subject = &v
		}
	}
	if v, ok := req.Deadline.Get(); ok {
		in.Deadline = &v
	}
	return in
}

// moneyToOAS service.Money → oas.Money（"123.45" 字符串）。
func moneyToOAS(m progressdb.Money) oas.Money {
	return oas.Money(m.StringFixed(2))
}

// setOptDateTime 把 *time.Time 写入 OAS OptNilDateTime（nil → null，非 nil → set）。
func setOptDateTime(dst *oas.OptNilDateTime, src *time.Time) {
	if src == nil {
		dst.SetToNull()
	} else {
		dst.SetTo(*src)
	}
}

// setOptInt64 把 *int64 写入 OAS OptNilInt64。
func setOptInt64(dst *oas.OptNilInt64, src *int64) {
	if src == nil {
		dst.SetToNull()
	} else {
		dst.SetTo(*src)
	}
}

// checkPermission 校验当前用户是否有指定权限码（统一处理破坏性/特权事件）。
//
// 业务背景：E12/E13/E_AS1 等 FromHolderRole=nil 的事件无 holder 校验天然约束，
// 必须由权限码兜底；admin 通过 *:* 通配自然有；cs 由 0020 migration grant 相应权限。
// 利用 EffectivePermissionsService 已有的 super_admin 短路 + grant/deny 三层语义。
func (h *ProjectHandler) checkPermission(ctx context.Context, userID int64, permCode string) error {
	codes, err := h.EffectivePerms.Compute(ctx, userID)
	if err != nil {
		return err
	}
	for _, c := range codes {
		if c == "*:*" || c == permCode {
			return nil
		}
	}
	return services.ErrCancelPermissionDenied
}

// projectListErrUnauthorized 构造 ProjectListRes 的 401 envelope（OAS 没生成
// ProjectsListUnauthorized 别名，复用通用 ErrorEnvelope 即可：projectsListRes interface
// 已在 oas_schemas_gen.go 给 ErrorEnvelope 实现）。
func projectListErrUnauthorized(msg string) oas.ProjectsListRes {
	e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeUnauthorized, msg)
	return &e
}
