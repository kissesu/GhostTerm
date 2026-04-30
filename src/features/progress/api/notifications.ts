/**
 * @file notifications.ts
 * @description 通知系统的 API 封装（Phase 12 前端入口）。
 *
 *              三个 REST endpoint：
 *                - listNotifications     GET    /api/notifications?unreadOnly=bool
 *                - markNotificationRead  POST   /api/notifications/:id/read
 *                - markAllNotificationsRead POST /api/notifications/read-all
 *
 *              WebSocket 推送由 wsClient.ts 单独负责；本文件只覆盖 REST。
 *
 *              所有响应通过 zod schema 二次校验（v2 §W1）；schema 漂移立即抛
 *              ProgressApiError(code='schema_drift')。
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { z } from 'zod';

import { apiFetch } from './client';

// ============================================
// 枚举：与 openapi.yaml NotificationType 一致
// ============================================

/**
 * 通知类型。改 enum 时三处必须同步：DB enum / openapi.yaml / 此 zod。
 */
export const NotificationTypeSchema = z.enum([
  'ball_passed',
  'deadline_approaching',
  'overdue',
  'new_feedback',
  'settlement_received',
  'project_terminated',
]);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

// ============================================
// Schema：通知实体
// ============================================

/**
 * 通知实体。对齐 openapi.yaml components.schemas.Notification。
 *
 * 字段说明：
 *   - projectId：可空可缺；nullable() 让 z 接受 null
 *   - readAt：未读时为 null；已读时为 ISO 8601 字符串
 *   - createdAt：必有，ISO 8601
 */
export const NotificationSchema = z.object({
  id: z.number().int(),
  userId: z.number().int(),
  type: NotificationTypeSchema,
  projectId: z.number().int().nullable().optional().default(null),
  title: z.string(),
  body: z.string(),
  isRead: z.boolean(),
  createdAt: z.string(),
  readAt: z.string().nullable().optional().default(null),
});

export type Notification = z.infer<typeof NotificationSchema>;

/** 列表响应：DataEnvelope.data 是 Notification[]；apiFetch 自动剥壳 */
export const NotificationListSchema = z.array(NotificationSchema);

// ============================================
// API 调用
// ============================================

/**
 * 列出当前用户最近通知。
 *
 * @param unreadOnly 仅未读？默认 false
 * @returns Notification[]，按 createdAt DESC 排序，最多 20 条
 * @throws ProgressApiError
 */
export async function listNotifications(unreadOnly = false): Promise<Notification[]> {
  const qs = unreadOnly ? '?unreadOnly=true' : '';
  return apiFetch(
    `/api/notifications${qs}`,
    { method: 'GET' },
    NotificationListSchema,
  );
}

/**
 * 标记单条通知为已读。
 *
 * @param notificationId 通知 ID
 * @throws ProgressApiError —— 404 = 通知不存在或非自己
 */
export async function markNotificationRead(notificationId: number): Promise<void> {
  await apiFetch(
    `/api/notifications/${notificationId}/read`,
    { method: 'POST' },
    z.void(),
  );
}

/**
 * 全部标为已读。
 *
 * @throws ProgressApiError
 */
export async function markAllNotificationsRead(): Promise<void> {
  await apiFetch(
    '/api/notifications/read-all',
    { method: 'POST' },
    z.void(),
  );
}

// ============================================
// WS Ticket：用 access token 换短期 ticket，给 ws.connect 用
// ============================================

/**
 * WS 短期票据响应。对齐 openapi.yaml WSTicket schema。
 */
export const WSTicketSchema = z.object({
  ticket: z.string().min(1),
  expiresAt: z.string(),
});

export type WSTicket = z.infer<typeof WSTicketSchema>;

/**
 * 申请 WS ticket。
 *
 * 业务背景：浏览器 WS 不支持 Authorization header，必须把鉴权信息放 query；
 * 短期 ticket（30s）是一次性凭证，consume_ws_ticket SECURITY DEFINER 函数保证。
 *
 * @returns 包含 raw ticket（base64url）+ 过期时间
 * @throws ProgressApiError
 */
export async function issueWSTicket(): Promise<WSTicket> {
  return apiFetch('/api/ws/ticket', { method: 'POST' }, WSTicketSchema);
}
