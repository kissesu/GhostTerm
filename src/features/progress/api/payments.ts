/**
 * @file payments.ts
 * @description 进度模块 payment 相关 API + zod schema（Phase 9 Worker F）。
 *
 *              对应 server openapi.yaml：
 *                - GET  /api/projects/{id}/payments  → PaymentListResponse
 *                - POST /api/projects/{id}/payments  → PaymentResponse (201)
 *
 *              Money 全链路 string：
 *                - 前端永远把 Money 当 "123.45" 字符串传输，不做 Number() 转换
 *                - 显示层再 parseFloat → toFixed(2)（仅展示用）
 *                - 提交时直接 string，避免 JS 浮点损失精度（与后端 db.Money 对齐）
 *
 *              Direction 严格 enum：customer_in / dev_settlement
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { z } from 'zod';

import { apiFetch } from './client';

// ============================================
// PaymentDirection
// ============================================

/**
 * 财务流向。
 *
 * 业务背景（spec §4.1 + migrations 0001 enum）：
 *   - customer_in：客户付款入账，会累加项目 total_received
 *   - dev_settlement：开发结算出账，必须有 related_user_id + screenshot_id
 */
export const PaymentDirectionSchema = z.enum(['customer_in', 'dev_settlement']);
export type PaymentDirection = z.infer<typeof PaymentDirectionSchema>;

// ============================================
// Payment（与 oas.Payment 字段一致；Money 是字符串）
// ============================================

/**
 * Payment schema —— 与 openapi.yaml components.schemas.Payment 字段一致。
 *
 * 业务约束：
 *   - amount 是 ^-?\d+(\.\d{1,2})?$（Money string）
 *   - relatedUserId / screenshotId 仅 dev_settlement 必填，其它情况 null
 */
/**
 * PaymentAttachmentRefSchema —— 单个凭证截图（id + filename）。
 *
 * 业务背景：migration 0014 payment_attachments 表 + payment_service.go LEFT JOIN jsonb_agg；
 * 与 FeedbackActivityPayload.attachments 同款形状（id 拼 /api/files/:id/download）。
 */
export const PaymentAttachmentRefSchema = z.object({
  id: z.number().int(),
  filename: z.string(),
});
export type PaymentAttachmentRef = z.infer<typeof PaymentAttachmentRefSchema>;

export const PaymentSchema = z.object({
  id: z.number().int(),
  projectId: z.number().int(),
  direction: PaymentDirectionSchema,
  amount: z.string(), // Money "123.45"
  paidAt: z.string(), // ISO datetime
  relatedUserId: z.number().int().nullable(),
  screenshotId: z.number().int().nullable(),
  remark: z.string(),
  recordedBy: z.number().int(),
  recordedAt: z.string(), // ISO datetime
  // 凭证截图列表：服务端永远返回数组（migration 0014 + handler 兜底空切片）；
  // .default([]) 兜底老快照里少这字段的极端情况
  attachments: z.array(PaymentAttachmentRefSchema).default([]),
});
export type Payment = z.infer<typeof PaymentSchema>;

// ============================================
// 请求体
// ============================================

/**
 * PaymentCreateRequest —— 与 openapi.yaml components.schemas.PaymentCreateRequest 对齐。
 *
 * 业务规则：
 *   - amount 必须 > 0（应用层 + DB CHECK 双保险）
 *   - dev_settlement 必填 relatedUserId + screenshotId
 *   - remark 非空
 */
export interface PaymentCreatePayload {
  direction: PaymentDirection;
  amount: string; // Money "123.45"
  paidAt: string; // ISO datetime
  relatedUserId?: number | null;
  screenshotId?: number | null;
  remark: string;
  // attachmentIds 可选：已通过 POST /api/files 上传得到的凭证截图 file_id 列表
  // （migration 0014 同事务 INSERT payment_attachments）
  attachmentIds?: number[];
}

// ============================================
// API 调用
// ============================================

/**
 * 列出项目下的全部 payment 流水。
 *
 * @param projectId 项目 ID
 * @returns Payment[]
 * @throws ProgressApiError
 */
export async function listProjectPayments(projectId: number): Promise<Payment[]> {
  return apiFetch(
    `/api/projects/${projectId}/payments`,
    { method: 'GET' },
    z.array(PaymentSchema),
  );
}

/**
 * 录入一条 payment 流水。
 *
 * @param projectId 项目 ID
 * @param payload   PaymentCreatePayload
 * @returns 创建的 Payment（201 响应体的 data 字段）
 * @throws ProgressApiError 422（amount<=0 / direction 非法 / settlement 缺字段 / project 不存在）
 */
export async function createPayment(
  projectId: number,
  payload: PaymentCreatePayload,
): Promise<Payment> {
  return apiFetch(
    `/api/projects/${projectId}/payments`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    PaymentSchema,
  );
}
