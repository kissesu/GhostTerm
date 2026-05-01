/*
@file activity.go
@description 进度时间线 handler 适配层 —— 把 ogen 生成的 ProjectsListActivities 接口
             转发到 services.ActivityService.List，并把 ActivityView 映射为 oas.Activity。

             业务流程：
              1. 取 AuthContext（缺失 → 返回 ErrInvalidAccessToken，由 errorEnvelopeHandler 映射 401）
              2. 解析 limit / before（ogen OptInt / OptString；服务层做 clamp / cursor 校验）
              3. 调 svc.List
              4. 错误映射：
                 - ErrActivityProjectNotFound → 404 ProjectsListActivitiesNotFound
                 - ErrInvalidCursor          → 422 ProjectsListActivitiesUnprocessableEntity
                 - 其它                       → bubble up，errorEnvelopeHandler 兜底 500
              5. payload jsonb → oas.ActivityPayload sum-type wrapper（按 kind switch）

             设计取舍：
              - handler 是薄适配层：业务 / RLS / clamp 全在 service，handler 只做协议翻译
              - 7 个 kind 显式 switch（ogen oneOf 不支持反射式 dispatch）
              - Money 字段保持 string（service 层产出 *::text，handler 不做 float 转换）

@author Atlas.oi
@date 2026-05-01
*/

package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/ghostterm/progress-server/internal/api/middleware"
	"github.com/ghostterm/progress-server/internal/api/oas"
	"github.com/ghostterm/progress-server/internal/services"
)

// ActivityHandler 实现 oas.Handler 中 ProjectsListActivities 方法。
type ActivityHandler struct {
	Svc services.ActivityService
}

// NewActivityHandler 构造 ActivityHandler。
//
// svc 必填；缺失时返回 error 让 router 启动期立即暴露配置漂移，
// 而不是运行时 nil deref（与 feedback handler 同模式）。
func NewActivityHandler(svc services.ActivityService) (*ActivityHandler, error) {
	if svc == nil {
		return nil, errors.New("activity handler: svc is required")
	}
	return &ActivityHandler{Svc: svc}, nil
}

// ProjectsListActivities — GET /api/projects/{id}/activities
//
// 业务流程见文件头注释。
func (h *ActivityHandler) ProjectsListActivities(
	ctx context.Context,
	params oas.ProjectsListActivitiesParams,
) (oas.ProjectsListActivitiesRes, error) {
	ac, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		// 未登录：返回 sentinel，让 errorEnvelopeHandler 兜底 401
		return nil, services.ErrInvalidAccessToken
	}

	// limit / before 解析
	// 注：ogen 的 decodeProjectsListActivitiesParams 已为 limit 设了默认 50；
	// 这里仍做 fallback 防御（直接构造 params 调用本方法的测试路径）
	limit := 50
	if v, ok := params.Limit.Get(); ok {
		limit = v
	}
	beforeCursor := ""
	if v, ok := params.Before.Get(); ok {
		beforeCursor = v
	}

	result, err := h.Svc.List(ctx, ac, params.ID, limit, beforeCursor)
	if err != nil {
		switch {
		case errors.Is(err, services.ErrActivityProjectNotFound):
			env := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeNotFound, fmt.Sprintf("项目 %d 不存在或无权访问", params.ID))
			res := oas.ProjectsListActivitiesNotFound(env)
			return &res, nil
		case errors.Is(err, services.ErrInvalidCursor):
			env := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeValidationFailed, "before 游标格式非法")
			res := oas.ProjectsListActivitiesUnprocessableEntity(env)
			return &res, nil
		}
		return nil, fmt.Errorf("activity handler: list: %w", err)
	}

	// 把 service 层 ActivityView 映射为 oas.Activity
	data := make([]oas.Activity, 0, len(result.Items))
	for _, item := range result.Items {
		mapped, mapErr := mapActivityToOAS(item)
		if mapErr != nil {
			return nil, fmt.Errorf("activity handler: map kind=%s source=%d: %w", item.Kind, item.SourceID, mapErr)
		}
		data = append(data, mapped)
	}

	resp := &oas.ActivityListResponse{Data: data}
	if result.NextCursor != nil {
		resp.NextCursor = oas.NewOptNilString(*result.NextCursor)
	}
	return resp, nil
}

// mapActivityToOAS 把 services.ActivityView 转为 oas.Activity。
//
// payload jsonb 按 kind 反序列化到对应 *Payload struct，再用 ogen 生成的
// New<X>ActivityPayload 构造 sum-type wrapper（详见 oas_schemas_gen.go::ActivityPayload）。
//
// 7 个 kind 必须显式列举：ogen oneOf 没有反射式 dispatch；
// 任何新增 kind 必须 (a) 在 VIEW 加 UNION (b) 在 OAS 加 schema (c) 在此 switch 加 case。
func mapActivityToOAS(v services.ActivityView) (oas.Activity, error) {
	out := oas.Activity{
		ID:         v.ID,
		SourceId:   v.SourceID,
		ProjectId:  v.ProjectID,
		Kind:       oas.ActivityKind(v.Kind),
		OccurredAt: v.OccurredAt,
		ActorId:    v.ActorID,
	}
	if v.ActorName != nil {
		out.ActorName = oas.NewOptNilString(*v.ActorName)
	}
	if v.ActorRoleName != nil {
		out.ActorRoleName = oas.NewOptNilString(*v.ActorRoleName)
	}

	switch v.Kind {
	case "project_created":
		var p oas.ProjectCreatedPayload
		if err := json.Unmarshal(v.Payload, &p); err != nil {
			return out, fmt.Errorf("unmarshal project_created: %w", err)
		}
		out.Payload = oas.NewProjectCreatedPayloadActivityPayload(p)
	case "feedback":
		var p oas.FeedbackActivityPayload
		if err := json.Unmarshal(v.Payload, &p); err != nil {
			return out, fmt.Errorf("unmarshal feedback: %w", err)
		}
		out.Payload = oas.NewFeedbackActivityPayloadActivityPayload(p)
	case "status_change":
		var p oas.StatusChangeActivityPayload
		if err := json.Unmarshal(v.Payload, &p); err != nil {
			return out, fmt.Errorf("unmarshal status_change: %w", err)
		}
		out.Payload = oas.NewStatusChangeActivityPayloadActivityPayload(p)
	case "quote_change":
		var p oas.QuoteChangeActivityPayload
		if err := json.Unmarshal(v.Payload, &p); err != nil {
			return out, fmt.Errorf("unmarshal quote_change: %w", err)
		}
		out.Payload = oas.NewQuoteChangeActivityPayloadActivityPayload(p)
	case "payment":
		var p oas.PaymentActivityPayload
		if err := json.Unmarshal(v.Payload, &p); err != nil {
			return out, fmt.Errorf("unmarshal payment: %w", err)
		}
		out.Payload = oas.NewPaymentActivityPayloadActivityPayload(p)
	case "thesis_version":
		var p oas.ThesisVersionActivityPayload
		if err := json.Unmarshal(v.Payload, &p); err != nil {
			return out, fmt.Errorf("unmarshal thesis_version: %w", err)
		}
		out.Payload = oas.NewThesisVersionActivityPayloadActivityPayload(p)
	case "project_file_added":
		var p oas.ProjectFileAddedPayload
		if err := json.Unmarshal(v.Payload, &p); err != nil {
			return out, fmt.Errorf("unmarshal project_file_added: %w", err)
		}
		out.Payload = oas.NewProjectFileAddedPayloadActivityPayload(p)
	default:
		return out, fmt.Errorf("unknown activity kind: %s", v.Kind)
	}

	return out, nil
}
