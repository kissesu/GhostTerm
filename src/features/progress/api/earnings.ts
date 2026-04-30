/**
 * @file earnings.ts
 * @description 进度模块 earnings（开发结算视图）相关 API + zod schema（Phase 9 Worker F）。
 *
 *              对应 server openapi.yaml：
 *                - GET /api/me/earnings → EarningsSummaryResponse
 *
 *              业务定位：
 *                - 当前登录用户的"我已结算多少"汇总
 *                - 永远只返回自己的数据：service 层强制 WHERE user_id = ac.UserID
 *                - 前端 EarningsView 据此渲染累计金额 + per-project 表格
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { z } from 'zod';

import { apiFetch } from './client';

// ============================================
// EarningsSummaryProject (per-project breakdown row)
// ============================================

export const EarningsSummaryProjectSchema = z.object({
  projectId: z.number().int(),
  projectName: z.string(),
  totalEarned: z.string(), // Money string
  settlementCount: z.number().int(),
  lastPaidAt: z.string().nullable(), // ISO datetime
});
export type EarningsSummaryProject = z.infer<typeof EarningsSummaryProjectSchema>;

// ============================================
// EarningsSummary（用户级聚合 + per-project 数组）
// ============================================

export const EarningsSummarySchema = z.object({
  userId: z.number().int(),
  totalEarned: z.string(), // Money string："9124.69"
  settlementCount: z.number().int(),
  lastPaidAt: z.string().nullable().optional(), // optional for safety
  projects: z.array(EarningsSummaryProjectSchema),
});
export type EarningsSummary = z.infer<typeof EarningsSummarySchema>;

// ============================================
// API 调用
// ============================================

/**
 * 拉取当前用户的开发结算汇总。
 *
 * 安全语义：服务端按当前 access token 的 user_id 强制过滤；前端不传 user_id。
 *
 * @returns EarningsSummary
 * @throws ProgressApiError
 */
export async function getMyEarnings(): Promise<EarningsSummary> {
  return apiFetch('/api/me/earnings', { method: 'GET' }, EarningsSummarySchema);
}
