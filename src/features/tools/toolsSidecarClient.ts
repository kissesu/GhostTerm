/**
 * @file toolsSidecarClient.ts
 * @description Python sidecar 调用封装。
 *              所有错误（sidecar 返回 ok:false / Rust invoke 失败）都统一抛 SidecarError，
 *              由上层 UI 弹 modal 显示（spec Section 7：不降级，暴露即修）。
 * @author Atlas.oi
 * @date 2026-04-17
 */
import { invoke } from '@tauri-apps/api/core';

export interface SidecarRequestBase {
  cmd: string;
}

export interface PingRequest extends SidecarRequestBase {
  cmd: 'ping';
}

export interface DetectRequest extends SidecarRequestBase {
  cmd: 'detect';
  file: string;
  template: TemplateJson;
}

export interface FixRequest extends SidecarRequestBase {
  cmd: 'fix';
  file: string;
  issue: IssueDict;
  value?: unknown;
}

export interface FixPreviewRequest extends SidecarRequestBase {
  cmd: 'fix_preview';
  file: string;
  issue: IssueDict;
  value?: unknown;
}

export interface ListRulesRequest extends SidecarRequestBase {
  cmd: 'list_rules';
}

export interface CancelRequest extends SidecarRequestBase {
  cmd: 'cancel';
}

/** extract_template 占位：sidecar 侧尚未实现，类型预留供后续 Task 21 使用 */
export interface ExtractTemplateRequest extends SidecarRequestBase {
  cmd: 'extract_template';
  file: string;
}

export type SidecarRequest =
  | PingRequest
  | DetectRequest
  | FixRequest
  | FixPreviewRequest
  | ListRulesRequest
  | CancelRequest
  | ExtractTemplateRequest;

export interface IssueDict {
  rule_id: string;
  loc: { para: number; run: number; char?: number };
  message: string;
  current: unknown;
  expected: unknown;
  fix_available: boolean;
  // 违规点扩展到一个完整"中文连续段 + 英文 token"（例："通过 submit"）
  snippet: string;
  // 段落预览（前 ~30 字符），供用户在 WPS 里 Ctrl-F 搜段定位
  context: string;
  issue_id: string;
  evidence_xml?: string | null;
}

export interface TemplateJson {
  rules: Record<string, { enabled: boolean; value: unknown }>;
}

export interface SidecarOk<T = unknown> {
  id: string;
  ok: true;
  result: T;
}

export interface SidecarErr {
  id: string | null;
  ok: false;
  error: string;
  code: string;
}

export class SidecarError extends Error {
  constructor(
    public code: string,
    public fullError: string,
  ) {
    super(`[${code}] ${fullError.split('\n')[0]}`);
    this.name = 'SidecarError';
  }
}

// 请求序号，保证同进程内每次调用 id 唯一
let _nextId = 0;
function genId(): string {
  _nextId += 1;
  return `req-${Date.now()}-${_nextId}`;
}

/**
 * 向 Python sidecar 发送请求并返回 result。
 *
 * 业务逻辑：
 * 1. 生成唯一 id，构造 payload 转发给 Rust command tools_sidecar_invoke
 * 2. Rust 层异常（进程不存在等）→ 包装为 SIDECAR_UNAVAILABLE
 * 3. sidecar 返回 ok:false → 包装为对应 code 的 SidecarError
 * 4. ok:true → 返回 result（泛型透传）
 */
export async function sidecarInvoke<T = unknown>(req: SidecarRequest): Promise<T> {
  const payload = { id: genId(), ...req };

  let raw: SidecarOk<T> | SidecarErr;
  try {
    raw = await invoke<SidecarOk<T> | SidecarErr>('tools_sidecar_invoke', { payload });
  } catch (rustErr) {
    throw new SidecarError('SIDECAR_UNAVAILABLE', String(rustErr));
  }

  if (!raw.ok) {
    throw new SidecarError(raw.code, raw.error);
  }

  return raw.result;
}

/**
 * 重启 sidecar 进程（由 ErrorModal 的"重启"按钮触发）
 */
export async function sidecarRestart(): Promise<void> {
  try {
    await invoke('tools_sidecar_restart');
  } catch (e) {
    throw new SidecarError('SIDECAR_RESTART_FAILED', String(e));
  }
}
