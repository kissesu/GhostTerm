/**
 * @file feedbacks.ts
 * @description 反馈系统的 API 封装（Phase 7 Worker D 前端入口）。
 *
 *              三个 endpoint 对齐 openapi.yaml：
 *                - listFeedbacks   GET    /api/projects/:id/feedbacks
 *                - createFeedback  POST   /api/projects/:id/feedbacks
 *                - updateFeedback  PATCH  /api/feedbacks/:id   （目前只用于状态切换）
 *
 *              所有响应通过 zod schema 二次校验（v2 §W1）；schema 漂移时立刻抛
 *              ProgressApiError(code='schema_drift')，拒绝静默接受错位数据。
 *
 *              不在本文件做：
 *              - 不做 React Query / store 自动 invalidation —— 这部分交给 feedbacksStore，
 *                api/* 模块仅提供"原子调用 + 校验"
 *              - 不做附件上传：附件在 FileService（Worker C）已有 upload endpoint，
 *                FeedbackInput 拿到 file_id 后传 attachmentIds 即可
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { z } from 'zod';

import { apiFetch } from './client';

// ============================================
// 枚举
// ============================================

/**
 * 反馈来源（与 openapi.yaml FeedbackSource 一致）。
 *
 * 业务背景：客户接触渠道；UI 让录入人选一个，便于后续统计哪个渠道反馈最多。
 */
export const FeedbackSourceSchema = z.enum(['phone', 'wechat', 'email', 'meeting', 'other']);
export type FeedbackSource = z.infer<typeof FeedbackSourceSchema>;

/**
 * 反馈状态（与 openapi.yaml FeedbackStatus 一致）。
 *
 * 业务语义：
 *   - pending：录入后默认值，等待负责人处理
 *   - done：已解决；UI 用勾选 icon 区分
 */
export const FeedbackStatusSchema = z.enum(['pending', 'done']);
export type FeedbackStatus = z.infer<typeof FeedbackStatusSchema>;

// ============================================
// Schema：反馈实体
// ============================================

/**
 * 反馈实体。对齐 openapi.yaml components.schemas.Feedback。
 *
 * recordedAt 是 RFC3339 字符串（服务端 time.Time 序列化结果）；前端用 new Date() 即可
 * 转 Date 实例供 toLocaleString 渲染。
 */
export const FeedbackSchema = z.object({
  id: z.number().int(),
  projectId: z.number().int(),
  content: z.string(),
  source: FeedbackSourceSchema,
  status: FeedbackStatusSchema,
  recordedBy: z.number().int(),
  recordedAt: z.string(),
  attachmentIds: z.array(z.number().int()).optional().default([]),
});

export type Feedback = z.infer<typeof FeedbackSchema>;

/** 列表响应：DataEnvelope.data 是 Feedback[]；apiFetch 自动剥壳 */
export const FeedbackListSchema = z.array(FeedbackSchema);

// ============================================
// 请求体类型
// ============================================

/**
 * 创建反馈请求体。content 必填且非空白；source 可选（缺省由后端 DB DEFAULT 兜底）。
 */
export interface CreateFeedbackInput {
  content: string;
  source?: FeedbackSource;
  attachmentIds?: number[];
}

/**
 * 更新反馈请求体。当前 v1 只允许更新 status；其它字段后端拒绝。
 */
export interface UpdateFeedbackInput {
  status: FeedbackStatus;
}

// ============================================
// API 调用
// ============================================

/**
 * 列出某项目下所有反馈（按 recorded_at ASC）。
 *
 * @param projectId 项目 ID
 * @returns Feedback[]，无反馈时返回空数组
 * @throws ProgressApiError
 */
export async function listFeedbacks(projectId: number): Promise<Feedback[]> {
  return apiFetch(
    `/api/projects/${projectId}/feedbacks`,
    { method: 'GET' },
    FeedbackListSchema,
  );
}

/**
 * 录入新反馈（项目 member 才能调用，由后端 RBAC + RLS 双层把关）。
 *
 * @param projectId 项目 ID
 * @param input     反馈正文 + 可选 source + 可选附件 file_id
 * @returns 服务端 RETURNING 的 Feedback（含新生成 id 和 recordedAt）
 * @throws ProgressApiError —— 422 = content 非法或 source 不在白名单
 */
export async function createFeedback(
  projectId: number,
  input: CreateFeedbackInput,
): Promise<Feedback> {
  return apiFetch(
    `/api/projects/${projectId}/feedbacks`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    FeedbackSchema,
  );
}

/**
 * 更新反馈状态（pending ↔ done）。
 *
 * @param feedbackId 反馈 ID
 * @param input      只含 status 字段
 * @returns 更新后的完整 Feedback
 * @throws ProgressApiError —— 404 = 反馈不存在或无权
 */
export async function updateFeedback(
  feedbackId: number,
  input: UpdateFeedbackInput,
): Promise<Feedback> {
  return apiFetch(
    `/api/feedbacks/${feedbackId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
    FeedbackSchema,
  );
}
