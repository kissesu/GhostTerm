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
  template: MinimalTemplateForDetect;
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

/** P4 语义字段：从 docx 自动抽取全部 32 个语义字段的当前值 */
export interface ExtractAllRequest extends SidecarRequestBase {
  cmd: 'extract_all';
  file: string;
}

/** P4 语义字段：基于用户在 HTML 预览中框选的段落，确认单个字段的值 */
export interface ExtractFromSelectionRequest extends SidecarRequestBase {
  cmd: 'extract_from_selection';
  file: string;
  // 用户框选的段落索引列表（对应 docx paragraph 顺序）
  para_indices: number[];
  // 要确认的语义字段 id（如 "title_font_size"）
  field_id: string;
}

/** P4 语义字段：列出引擎支持的全部字段定义 */
export interface ListFieldsRequest extends SidecarRequestBase {
  cmd: 'list_fields';
}

export type SidecarRequest =
  | PingRequest
  | DetectRequest
  | FixRequest
  | FixPreviewRequest
  | ListRulesRequest
  | CancelRequest
  | ExtractTemplateRequest
  | ExtractAllRequest
  | ExtractFromSelectionRequest
  | ListFieldsRequest;

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

/** detect 命令的最小模板结构（P2 兼容）。完整模板定义见 templates/TemplateStore.ts */
export interface MinimalTemplateForDetect {
  rules: Record<string, { enabled: boolean; value: unknown }>;
}

/** @deprecated 请使用 MinimalTemplateForDetect 或 templates/TemplateStore.ts 的 TemplateJson */
export type TemplateJson = MinimalTemplateForDetect;

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

// ============================================================
// P4 语义字段：extract_all / extract_from_selection / list_fields
// 响应类型定义
// ============================================================

/** 单个语义字段在模板中的当前设定值（对应 rules map 的 entry） */
export interface ExtractedFieldValue {
  enabled: boolean;
  // value 结构因字段而异（如 { pt: 12 } / { name: "宋体" }），用 Record 宽松类型
  value: Record<string, unknown>;
}

/** extract_all 返回的单条证据：sidecar 从哪个段落推断出该字段值 */
export interface ExtractEvidence {
  field_id: string;
  // 来源段落的 0-based 索引
  source_para_idx: number;
  // 来源段落的原始文本片段（截取前 ~80 字符）
  source_text: string;
  // 置信度 0.0–1.0
  confidence: number;
}

/** extract_all 命令的返回结构 */
export interface ExtractAllResult {
  // key 为 field_id，对应 list_fields 返回的 FieldDef.id
  rules: Record<string, ExtractedFieldValue>;
  evidence: ExtractEvidence[];
  // 未能匹配到任何规则的段落列表，用于调试和兜底 HTML 选取
  unmatched_paragraphs: Array<{ idx: number; text: string; reason: string }>;
}

/** extract_from_selection 命令的返回结构 */
export interface ExtractFromSelectionResult {
  field_id: string;
  // 识别到的字段值（结构与 ExtractedFieldValue.value 一致）
  value: Record<string, unknown>;
  confidence: number;
  evidence: {
    source_text: string;
    // 命中的正则/关键词模式列表，方便调试
    matched_patterns: string[];
  };
}

/** list_fields 返回的单个字段定义 */
export interface FieldDef {
  id: string;
  label: string;
  // 字段所属文档区域：front=封面、body=正文、back=参考文献/附录、global=全局
  group: 'front' | 'body' | 'back' | 'global';
  // 在 UI 中的显示排序权重（越小越靠前）
  order: number;
  // 该字段关注的 docx 属性名列表（如 ["fontSize", "fontName"]）
  applicable_attributes: string[];
}

/** list_fields 命令的返回结构 */
export interface ListFieldsResult {
  fields: FieldDef[];
}
