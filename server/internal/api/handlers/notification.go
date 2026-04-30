/*
@file notification.go
@description 通知相关 HTTP handler 实现（Phase 12 Lead）：
             - NotificationsList         GET  /api/notifications        ?unreadOnly=bool
             - NotificationsMarkRead     POST /api/notifications/{id}/read
             - NotificationsMarkAllRead  POST /api/notifications/read-all

             业务流程：
             - 从 ctx 取 AuthContext（鉴权中间件 / SecurityHandler 已注入）
             - 调 NotificationService 对应方法
             - service 视图模型 services.Notification → oas.Notification 转换

             错误映射：
             - ErrNotificationNotFound → 404 not_found（仅 MarkRead 路径暴露）
             - 其它非 sentinel 错误 → 走 router.errorEnvelopeHandler 兜底
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

// NotificationHandler 实现 ogen 生成 oas.Handler 中与通知相关的 3 个方法。
type NotificationHandler struct {
	Svc services.NotificationService
}

// NewNotificationHandler 构造 NotificationHandler。
func NewNotificationHandler(svc services.NotificationService) *NotificationHandler {
	return &NotificationHandler{Svc: svc}
}

// ============================================================
// NotificationsList — GET /api/notifications
// ============================================================

// NotificationsList 列出当前用户的通知（按 created_at DESC，限 20）。
//
// 业务流程：
//  1. 从 ctx 取 AuthContext；缺失返回错误（由 errorEnvelopeHandler 映射 401）
//  2. params.UnreadOnly.Or(false) 决定是否仅返回未读
//  3. 调 svc.List(ctx, userID, unreadOnly, 0)；service 内部用默认 20 limit 兜底
//  4. services.Notification → oas.Notification 转换
func (h *NotificationHandler) NotificationsList(ctx context.Context, params oas.NotificationsListParams) (*oas.NotificationListResponse, error) {
	ac, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		return nil, errors.New("notification handler: missing auth context")
	}

	unreadOnly := params.UnreadOnly.Or(false)
	list, err := h.Svc.List(ctx, ac.UserID, unreadOnly, 0)
	if err != nil {
		return nil, fmt.Errorf("notification handler: list: %w", err)
	}

	out := make([]oas.Notification, 0, len(list))
	for _, n := range list {
		out = append(out, toOASNotification(n))
	}
	return &oas.NotificationListResponse{Data: out}, nil
}

// ============================================================
// NotificationsMarkRead — POST /api/notifications/{id}/read
// ============================================================

// NotificationsMarkRead 把单条通知标为已读。
//
// 业务流程：
//  1. 从 ctx 取 AuthContext
//  2. 调 svc.MarkRead(ctx, userID, notificationID)
//  3. ErrNotificationNotFound → 404；其它错误 → router 兜底
//  4. 成功 → 204 NoContent
func (h *NotificationHandler) NotificationsMarkRead(ctx context.Context, params oas.NotificationsMarkReadParams) (oas.NotificationsMarkReadRes, error) {
	ac, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		return nil, errors.New("notification handler: missing auth context")
	}
	if err := h.Svc.MarkRead(ctx, ac.UserID, params.ID); err != nil {
		if errors.Is(err, services.ErrNotificationNotFound) {
			e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeNotFound, fmt.Sprintf("通知 %d 不存在", params.ID))
			return &e, nil
		}
		return nil, fmt.Errorf("notification handler: mark read: %w", err)
	}
	return &oas.NotificationsMarkReadNoContent{}, nil
}

// ============================================================
// NotificationsMarkAllRead — POST /api/notifications/read-all
// ============================================================

// NotificationsMarkAllRead 把当前用户所有未读通知一次性标读。
//
// ogen 签名：error 直接返回（无 res 类型）。无错误即 204。
func (h *NotificationHandler) NotificationsMarkAllRead(ctx context.Context) error {
	ac, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		return errors.New("notification handler: missing auth context")
	}
	if err := h.Svc.MarkAllRead(ctx, ac.UserID); err != nil {
		return fmt.Errorf("notification handler: mark all read: %w", err)
	}
	return nil
}

// ============================================================
// 视图模型转换：services.Notification → oas.Notification
// ============================================================

// toOASNotification 把 service 层视图转为 oas 层视图。
//
// 业务背景：
//   - service.Notification.DeliveredAt 是 outbox 内部状态，不暴露给前端
//   - oas.Notification.ProjectId 是 OptNilInt64（可空可缺）；nil 时 SetToNull 而非 Reset
//     —— 与 zod schema "nullable: true" 对齐
//   - oas.Notification.ReadAt 是 OptNilDateTime；同上
func toOASNotification(n services.Notification) oas.Notification {
	out := oas.Notification{
		ID:        n.ID,
		UserId:    n.UserID,
		Type:      oas.NotificationType(n.Type),
		Title:     n.Title,
		Body:      n.Body,
		IsRead:    n.IsRead,
		CreatedAt: n.CreatedAt,
	}
	if n.ProjectID != nil {
		out.ProjectId.SetTo(*n.ProjectID)
	} else {
		out.ProjectId.SetToNull()
	}
	if n.ReadAt != nil {
		out.ReadAt.SetTo(*n.ReadAt)
	} else {
		out.ReadAt.SetToNull()
	}
	return out
}
