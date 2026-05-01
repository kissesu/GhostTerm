/**
 * @file activities.ts
 * @description 进度时间线 API client - fetch + zod 校验 + silentRefreshOnce 复用 401 自愈
 *
 *              业务流程：
 *              1. ActivitySchema 是按 kind 字段做的 zod discriminated union，
 *                 与后端 OAS 7 个 *Payload 一一对应；任何字段漂移立即抛运行时错误
 *              2. ActivityListResponseSchema 同时持有 data + nextCursor —— 这跟普通
 *                 DataEnvelope 不同（普通 envelope 仅 { data: T }），故本文件不能直接
 *                 走 client.ts::apiFetch（apiFetch 会把 nextCursor 当作不可见字段丢弃）
 *              3. 自实现 fetch + 401 silent refresh + retry：复用 client.ts 导出的
 *                 silentRefreshOnce + getBaseUrl，行为与 apiFetch 一致
 *              4. 错误分支抛 ProgressApiError（与其它 API 一致）；schema 校验失败
 *                 抛 code='schema_drift' 拒绝静默接受漂移数据
 *
 *              不做的事：
 *              - 不在前端做时间排序（service 层 ORDER BY occurred_at DESC, id DESC）
 *              - 不缓存（Phase 7 由 activitiesStore 负责）
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */

import { z } from 'zod';

import { getAccessToken } from '../../../shared/stores/globalAuthStore';

import { getBaseUrl, ProgressApiError, silentRefreshOnce } from './client';

// ============================================
// 7 个 *Payload schema —— 与 server/openapi.yaml components.schemas.*Payload 一致
// ============================================

const ProjectCreatedPayloadSchema = z.object({
  name: z.string(),
  status: z.string(),
  priority: z.string(),
  deadline: z.string(),
  originalQuote: z.string(), // Money: decimal as string
});

const FeedbackActivityPayloadSchema = z.object({
  content: z.string(),
  source: z.enum(['phone', 'wechat', 'email', 'meeting', 'other']),
  status: z.enum(['pending', 'done']),
});

const StatusChangeActivityPayloadSchema = z.object({
  eventCode: z.string(),
  eventName: z.string(),
  fromStatus: z.string().nullable().optional(),
  toStatus: z.string(),
  fromHolderRoleId: z.number().int().nullable().optional(),
  toHolderRoleId: z.number().int().nullable().optional(),
  fromHolderUserId: z.number().int().nullable().optional(),
  toHolderUserId: z.number().int().nullable().optional(),
  remark: z.string(),
});

const QuoteChangeActivityPayloadSchema = z.object({
  changeType: z.enum(['append', 'modify', 'after_sales']),
  delta: z.string(),
  oldQuote: z.string(),
  newQuote: z.string(),
  reason: z.string(),
  phase: z.string(),
});

const PaymentActivityPayloadSchema = z.object({
  direction: z.enum(['customer_in', 'dev_settlement']),
  amount: z.string(),
  paidAt: z.string(),
  relatedUserId: z.number().int().nullable().optional(),
  screenshotId: z.number().int().nullable().optional(),
  remark: z.string(),
});

const ThesisVersionActivityPayloadSchema = z.object({
  fileId: z.number().int(),
  versionNo: z.number().int(),
  remark: z.string().nullable().optional(),
});

const ProjectFileAddedPayloadSchema = z.object({
  fileId: z.number().int(),
  category: z.enum(['sample_doc', 'source_code']),
});

// ============================================
// Activity discriminated union by `kind`
// ============================================

// 共享基础字段：Activity wire 上的 sourceId/projectId 是 int64 → number
const baseActivityFields = {
  id: z.string(),
  sourceId: z.number().int(),
  projectId: z.number().int(),
  occurredAt: z.string(),
  actorId: z.number().int(),
  actorName: z.string().nullable().optional(),
  actorRoleName: z.string().nullable().optional(),
};

/**
 * Activity discriminated union。
 *
 * `kind` 字段决定 payload 形状；zod 在解析时按 literal 匹配分支，
 * 错误时同时报告 kind 不在白名单或 payload 字段漂移，定位精确。
 */
export const ActivitySchema = z.discriminatedUnion('kind', [
  z.object({
    ...baseActivityFields,
    kind: z.literal('project_created'),
    payload: ProjectCreatedPayloadSchema,
  }),
  z.object({
    ...baseActivityFields,
    kind: z.literal('feedback'),
    payload: FeedbackActivityPayloadSchema,
  }),
  z.object({
    ...baseActivityFields,
    kind: z.literal('status_change'),
    payload: StatusChangeActivityPayloadSchema,
  }),
  z.object({
    ...baseActivityFields,
    kind: z.literal('quote_change'),
    payload: QuoteChangeActivityPayloadSchema,
  }),
  z.object({
    ...baseActivityFields,
    kind: z.literal('payment'),
    payload: PaymentActivityPayloadSchema,
  }),
  z.object({
    ...baseActivityFields,
    kind: z.literal('thesis_version'),
    payload: ThesisVersionActivityPayloadSchema,
  }),
  z.object({
    ...baseActivityFields,
    kind: z.literal('project_file_added'),
    payload: ProjectFileAddedPayloadSchema,
  }),
]);

export type Activity = z.infer<typeof ActivitySchema>;

/**
 * 列表响应 schema —— 注意这个 envelope 包含 nextCursor，与普通 DataEnvelope 不同
 * （ActivityListResponse 在 OAS 是顶层 schema，本身就是 envelope）。
 */
const ActivityListResponseSchema = z.object({
  data: z.array(ActivitySchema),
  nextCursor: z.string().nullable().optional(),
});

// ============================================
// Error envelope —— 与 client.ts ErrorEnvelopeSchema 一致
// ============================================
const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

// ============================================
// API 调用
// ============================================

/**
 * 拉取项目进度时间线（按 occurred_at DESC + id DESC 倒序）。
 *
 * 业务逻辑说明：
 *   1. 注入 Authorization Bearer header（与 apiFetch 同源 store）
 *   2. 401 时单飞 silentRefreshOnce + 用新 token 重试一次
 *   3. 非 2xx → 解析 ErrorEnvelope → ProgressApiError
 *   4. 2xx → ActivityListResponseSchema.parse；漂移抛 schema_drift
 *   5. 返回 { items, nextCursor }；调用方拿 nextCursor 当作下一页 before 参数
 *
 * @param projectId 项目 ID
 * @param cursor 上一页 nextCursor；首次查询不传
 * @param limit 单页数量，默认 50（后端 clamp 1-100）
 * @returns 解析后的活动列表 + 下一页游标
 * @throws ProgressApiError
 */
export async function getActivities(
  projectId: number,
  cursor?: string,
  limit = 50,
): Promise<{ items: Activity[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (cursor) {
    params.set('before', cursor);
  }
  const path = `/api/projects/${projectId}/activities?${params.toString()}`;

  // 第一步：发起请求（带 Authorization）
  let res = await doFetch(path);

  // 第二步：401 silent refresh + 重试一次
  if (res.status === 401) {
    const refreshed = await silentRefreshOnce();
    if (refreshed) {
      res = await doFetch(path);
    }
  }

  // 第三步：解析响应体
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  // 第四步：错误分支
  if (!res.ok) {
    const parsed = ErrorEnvelopeSchema.safeParse(body);
    if (parsed.success) {
      throw new ProgressApiError(
        res.status,
        parsed.data.error.code,
        parsed.data.error.message,
        parsed.data.error.details,
      );
    }
    throw new ProgressApiError(
      res.status,
      'unknown',
      `Request failed with status ${res.status}`,
      body,
    );
  }

  // 第五步：成功分支 —— 顶层就是 ActivityListResponse（不是 DataEnvelope 包裹）
  const result = ActivityListResponseSchema.safeParse(body);
  if (!result.success) {
    throw new ProgressApiError(
      res.status,
      'schema_drift',
      'Response schema mismatch',
      result.error.issues,
    );
  }
  return {
    items: result.data.data,
    nextCursor: result.data.nextCursor ?? null,
  };
}

// ============================================
// 私有：构造 fetch 请求 + 注入 Bearer token
// ============================================

async function doFetch(path: string): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = getAccessToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return fetch(`${getBaseUrl()}${path}`, { method: 'GET', headers });
}
