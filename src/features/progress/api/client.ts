/**
 * @file client.ts
 * @description 进度模块 API 客户端核心：apiFetch + ProgressApiError。
 *
 *              对齐 v2 §W1 修订：
 *              1. 所有响应必须包在 DataEnvelope { data: T } 中，client 层自动剥壳
 *              2. 非 2xx 响应解析 ErrorEnvelope { error: { code, message, details } }
 *                 并抛 ProgressApiError；解析失败也抛同类型，code='unknown'
 *              3. 2xx 响应必须传入 zod schema，校验失败抛 code='schema_drift'
 *                 拒绝静默吃下 schema 漂移
 *              4. accessToken 从 progressAuthStore 读取注入 Bearer header；
 *                 登录/刷新接口可显式传 anonymous=true 跳过
 *
 *              不做的事（明确拒绝）：
 *              - 不做 401 自动 refresh + retry：refresh 流程涉及 token_version 校验，
 *                Phase 2 才能正确实现；Phase 0d 的 401 直接暴露给上层
 *              - 不做超时/重试：失败暴露给调用方，对应"禁止降级回退"原则
 *
 *              BASE_URL 通过 Vite 环境变量 VITE_PROGRESS_API_BASE_URL 注入；
 *              开发环境默认 http://localhost:8080，与 server/cmd/server 默认监听一致。
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { z } from 'zod';
import { getAccessToken } from '../stores/progressAuthStore';

// ============================================
// 配置：API base URL
// ============================================
// import.meta.env 是 Vite 注入的；测试环境 vitest 也支持
const BASE_URL: string =
  (import.meta.env?.VITE_PROGRESS_API_BASE_URL as string | undefined) ??
  'http://localhost:8080';

// ============================================
// 错误对象：携带 status / code / message / details 四元组
// ============================================

/**
 * Progress API 统一错误类型。
 *
 * 业务侧 catch 时可按 `err.code` 判断分支：
 *   - 'unauthorized'   → 重新登录
 *   - 'schema_drift'   → 提示用户后端版本不匹配，需要重新生成 types
 *   - 'unknown'        → 网络层错误或非标准响应体
 *   - 其他 enum 值     → 见 openapi.yaml ErrorEnvelope.code 枚举
 */
export class ProgressApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ProgressApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ============================================
// 错误响应 schema
// ============================================
const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

// ============================================
// apiFetch：单一入口
// ============================================

interface ApiFetchOptions extends RequestInit {
  /** 跳过 Authorization 注入（登录、刷新等公开接口） */
  anonymous?: boolean;
}

/**
 * 发起 progress API 请求并对响应进行 schema 校验。
 *
 * 业务逻辑说明：
 * 1. 注入 Authorization header（除非 options.anonymous=true）
 * 2. 默认 Content-Type 为 application/json
 * 3. 响应非 2xx：解析 ErrorEnvelope → 抛 ProgressApiError
 * 4. 响应 2xx：解析 DataEnvelope({ data: schema }) → 返回 data 字段
 * 5. schema 校验失败：抛 ProgressApiError(code='schema_drift')
 *
 * @param path   API 路径（以 '/' 开头），如 '/api/auth/me'
 * @param init   RequestInit + 进度模块扩展（anonymous）
 * @param schema 数据载荷的 zod schema（envelope 内 data 字段的形状）
 * @returns      经 schema.parse 校验过的数据载荷
 * @throws       ProgressApiError
 */
export async function apiFetch<T>(
  path: string,
  init: ApiFetchOptions | undefined,
  schema: z.ZodType<T>,
): Promise<T> {
  const { anonymous, headers: initHeaders, ...rest } = init ?? {};

  // ============================================
  // 第一步：构造 headers
  // 默认 application/json；非匿名请求注入 Authorization
  // ============================================
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((initHeaders as Record<string, string> | undefined) ?? {}),
  };
  if (!anonymous) {
    const token = getAccessToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  // ============================================
  // 第二步：发起请求
  // 网络层失败（DNS / 拒绝连接）由 fetch 自身抛 TypeError，
  // 上层 try/catch 即可识别；这里不做包装以保留原始堆栈
  // ============================================
  const res = await fetch(`${BASE_URL}${path}`, { ...rest, headers });

  // ============================================
  // 第三步：解析响应体（容错：可能不是 JSON）
  // ============================================
  // 204 No Content 不会有响应体
  if (res.status === 204) {
    // 204 必须返回 void/undefined 类型；调用方传 z.void() 之类即可对齐
    return schema.parse(undefined);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  // ============================================
  // 第四步：错误分支
  // ============================================
  // 401 自动 clearLocal 触发 ProgressShell 切回 LoginPage（防止死锁在 error 页面）
  // 排除 anonymous 接口（login/refresh）：这些接口的 401 是凭据错误而非会话失效
  if (res.status === 401 && !anonymous) {
    // 动态 import 避免循环依赖（client.ts 已 import getAccessToken 同 store，扩展 dynamic import）
    const { useProgressAuthStore } = await import('../stores/progressAuthStore');
    useProgressAuthStore.getState().clearLocal();
  }
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

  // ============================================
  // 第五步：成功分支 - 校验 DataEnvelope 包裹
  // ============================================
  const envelopeSchema = z.object({ data: schema });
  const result = envelopeSchema.safeParse(body);
  if (!result.success) {
    throw new ProgressApiError(
      res.status,
      'schema_drift',
      'Response schema mismatch',
      result.error.issues,
    );
  }
  return result.data.data;
}

/** 暴露给调试/测试，避免直接读 import.meta.env 的硬耦合 */
export function getBaseUrl(): string {
  return BASE_URL;
}
