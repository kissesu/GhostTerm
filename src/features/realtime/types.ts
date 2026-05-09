/**
 * @file types.ts
 * @description SSE 实时同步事件 envelope schema（spec v3.5 §3）
 *              客户端用 zod 校验，schema 漂移时前端 log warn 但不渲染（防错位数据）
 * @author Atlas.oi
 * @date 2026-05-09
 */
import { z } from 'zod';

export const EventTypeSchema = z.enum([
  'project.created',
  'project.updated',
  'role_permissions.updated',
  'feedback.created',
  'payment.created',
]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const EventEnvelopeSchema = z.object({
  id: z.number().int(),
  type: EventTypeSchema,
  occurredAt: z.string(),
  actorUserId: z.number().int(),
  data: z.unknown(),
});
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
