/**
 * @file quotes.ts
 * @description 费用变更 API client + zod schema —— Phase 8 Worker E。
 *
 *              提供两条 API 调用 helper：
 *              - listQuoteChanges(projectId)        GET  /api/projects/{id}/quote-changes
 *              - createQuoteChange(projectId, req)  POST /api/projects/{id}/quote-changes
 *
 *              Money 字段约束（与后端 db.Money 对齐）：
 *              - 全链路用字符串 "123.45" 表示金额
 *              - 拒绝 3+ 位小数 —— 客户端 isValidMoneyString 先校验，越界直接抛错而非
 *                送到后端再被 ProgressApiError 反弹（提前失败更直观，省一次请求）
 *              - 这条规则与服务端 db.MoneyFromString 保持完全相同的契约
 *
 *              schema 校验：
 *              - QuoteChangeSchema 用 zod 验证响应；schema drift 时 client.ts 抛
 *                ProgressApiError(code='schema_drift')
 *              - 与 openapi.yaml components.schemas.QuoteChange 字段一一对应
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { z } from 'zod';

import { apiFetch } from './client';

// ============================================
// 公共：Money 字符串校验 + 类型
// ============================================

/**
 * Money 字符串正则：符合 OpenAPI Money pattern。
 *
 * 业务规则：
 *   - 整数部分：可正可负
 *   - 小数部分：可缺省，最多 2 位（拒绝 3+ 位避免静默截断）
 *   - 例：合法 "0" / "10" / "-100" / "1.5" / "1.50"；非法 "1.234" / "abc" / ""
 *
 * 与服务端 db.MoneyFromString 同义；为保证语义一致，正则与后端 OAS pattern 完全相同。
 */
export const MONEY_PATTERN = /^-?\d+(\.\d{1,2})?$/;

/**
 * 校验 Money 字符串格式。
 *
 * 调用时机：
 *   - QuoteChangeDialog 提交前 → 拒绝 3+ 位小数
 *   - createQuoteChange caller 必须先确保 delta/newQuote 字符串通过本校验
 */
export function isValidMoneyString(s: string): boolean {
  return MONEY_PATTERN.test(s);
}

// ============================================
// QuoteChange 响应 schema
// ============================================

/** 费用变更类型，与 openapi.yaml QuoteChangeType 对齐 */
export const QuoteChangeTypeSchema = z.enum(['append', 'modify', 'after_sales']);
export type QuoteChangeType = z.infer<typeof QuoteChangeTypeSchema>;

/** ProjectStatus 与 openapi.yaml ProjectStatus 对齐（仅本文件用） */
const ProjectStatusSchema = z.enum([
  'dealing', 'quoting', 'developing', 'confirming',
  'delivered', 'paid', 'archived', 'after_sales', 'cancelled',
]);

/** Money 字符串 schema（强约束 2 位小数） */
const MoneySchema = z.string().regex(MONEY_PATTERN, '金额格式无效（最多 2 位小数）');

/**
 * 费用变更日志：对应 openapi.yaml QuoteChange schema。
 *
 * 字段命名：保留后端的 camelCase（changeType / projectId / oldQuote / ...），
 * 前端业务代码不再二次重命名，避免语义漂移。
 */
export const QuoteChangeSchema = z.object({
  id: z.number().int(),
  projectId: z.number().int(),
  changeType: QuoteChangeTypeSchema,
  delta: MoneySchema,
  oldQuote: MoneySchema,
  newQuote: MoneySchema,
  reason: z.string(),
  phase: ProjectStatusSchema,
  changedBy: z.number().int(),
  changedAt: z.string(), // ISO date-time（不强制 z.string().datetime()，pg timestamptz 输出格式可能含微秒）
});

export type QuoteChange = z.infer<typeof QuoteChangeSchema>;

/** 列表响应 schema */
export const QuoteChangeListSchema = z.array(QuoteChangeSchema);

// ============================================
// 创建请求体类型
// ============================================

/**
 * 创建费用变更请求体。
 *
 * 业务约束：
 *   - reason 必填且 trim 后非空
 *   - changeType=append/after_sales 必须填 delta
 *   - changeType=modify 必须填 newQuote
 *   - delta / newQuote 必须通过 isValidMoneyString 校验
 */
export interface QuoteChangeCreateRequest {
  changeType: QuoteChangeType;
  delta?: string;
  newQuote?: string;
  reason: string;
}

// ============================================
// API helpers
// ============================================

/**
 * 列出项目的费用变更日志。
 *
 * @param projectId 项目 id（int64，但 JS Number 在 < 2^53 范围内安全）
 * @returns         按 changed_at ASC 排序的费用变更日志数组（后端兜底）
 */
export async function listQuoteChanges(projectId: number): Promise<QuoteChange[]> {
  return apiFetch<QuoteChange[]>(
    `/api/projects/${projectId}/quote-changes`,
    undefined,
    QuoteChangeListSchema,
  );
}

/**
 * 提交一条费用变更。
 *
 * 业务流程：
 *  1. 入参 client-side 校验（reason 非空 + delta/newQuote 互斥 + Money 格式）
 *     —— 任一失败抛 Error("validation_failed: <reason>")，不发请求节省 round-trip
 *  2. POST /api/projects/{id}/quote-changes
 *  3. 响应经 QuoteChangeSchema 校验后返回
 *
 * 后端会做相同校验，但前端先做一遍可以让 UI 立刻反馈（disable 按钮 / 红色边框）。
 */
export async function createQuoteChange(
  projectId: number,
  req: QuoteChangeCreateRequest,
): Promise<QuoteChange> {
  // ============================================
  // 客户端校验
  // ============================================
  if (!req.reason || req.reason.trim() === '') {
    throw new Error('validation_failed: reason 必填');
  }
  switch (req.changeType) {
    case 'append':
    case 'after_sales':
      if (req.delta === undefined || req.delta === '') {
        throw new Error(`validation_failed: ${req.changeType} 必须填 delta`);
      }
      if (!isValidMoneyString(req.delta)) {
        throw new Error('validation_failed: delta 金额格式无效（最多 2 位小数）');
      }
      break;
    case 'modify':
      if (req.newQuote === undefined || req.newQuote === '') {
        throw new Error('validation_failed: modify 必须填 newQuote');
      }
      if (!isValidMoneyString(req.newQuote)) {
        throw new Error('validation_failed: newQuote 金额格式无效（最多 2 位小数）');
      }
      break;
    default:
      throw new Error(`validation_failed: 未知 changeType ${String(req.changeType)}`);
  }

  // ============================================
  // 发请求
  // ============================================
  return apiFetch<QuoteChange>(
    `/api/projects/${projectId}/quote-changes`,
    {
      method: 'POST',
      body: JSON.stringify(req),
    },
    QuoteChangeSchema,
  );
}
