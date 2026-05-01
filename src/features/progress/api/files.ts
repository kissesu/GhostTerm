/**
 * @file files.ts
 * @description 进度模块文件管理 API 封装。
 *
 *              对应后端 endpoint：
 *                - POST   /api/files                          上传文件 (multipart)
 *                - GET    /api/files/:id                      下载文件（通过 buildDownloadURL 生成 URL）
 *                - GET    /api/projects/:id/files             列出项目附件
 *                - POST   /api/projects/:id/thesis-versions   创建论文版本
 *                - GET    /api/projects/:id/thesis-versions   列出论文版本历史
 *
 *              v2 §W1 要求所有响应在 client 层用 zod 二次校验：
 *              - 上传/列表/创建版本走 apiFetch（含 zod 校验）
 *              - 下载是字节流，不做 envelope，由调用方按 URL + Bearer header 自取
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { z } from 'zod';

import { apiFetch, getBaseUrl, ProgressApiError } from './client';
import { getAccessToken } from '../../../shared/stores/globalAuthStore';
import { silentRefreshOnce } from './client';

// ============================================================
// Schema：与 openapi.yaml components.schemas.* 对齐
// ============================================================

/** FileMetadata：上传响应 / 列表嵌套都用同一个形状。 */
export const FileMetadataSchema = z.object({
  id: z.number().int(),
  uuid: z.string().uuid(),
  filename: z.string(),
  sizeBytes: z.number().int(),
  mimeType: z.string(),
  uploadedBy: z.number().int(),
  uploadedAt: z.string(),
});

export type FileMetadata = z.infer<typeof FileMetadataSchema>;

/** ProjectFile：附件视图（含嵌套 file 元数据）。 */
export const ProjectFileSchema = z.object({
  id: z.number().int(),
  projectId: z.number().int(),
  fileId: z.number().int(),
  category: z.enum(['sample_doc', 'source_code']),
  addedAt: z.string(),
  file: FileMetadataSchema,
});

export type ProjectFile = z.infer<typeof ProjectFileSchema>;

/** ThesisVersion：论文版本视图。 */
export const ThesisVersionSchema = z.object({
  id: z.number().int(),
  projectId: z.number().int(),
  fileId: z.number().int(),
  versionNo: z.number().int(),
  // 后端 nullable string + ogen 的 OptNilString 会序列化为 null/缺失/字符串三态
  remark: z.string().nullish(),
  uploadedBy: z.number().int(),
  uploadedAt: z.string(),
  file: FileMetadataSchema,
});

export type ThesisVersion = z.infer<typeof ThesisVersionSchema>;

const ProjectFileListSchema = z.array(ProjectFileSchema);
const ThesisVersionListSchema = z.array(ThesisVersionSchema);

// ============================================================
// 上传 multipart：fetch 直接调用（apiFetch 默认设 Content-Type: application/json，
// multipart 必须让浏览器自动加 boundary）
// ============================================================

/**
 * 上传单个文件（multipart/form-data）。
 *
 * 业务流程：
 *   1. 构造 FormData，字段名固定为 'file'（与后端 oas 解码一致）
 *   2. 注入 Authorization header（apiFetch 不能用，需要保留 Content-Type 由浏览器设置）
 *   3. 失败时手动 parse ErrorEnvelope 抛 ProgressApiError（与 apiFetch 失败语义一致）
 *   4. 成功响应走 zod 校验，返回 FileMetadata
 *
 * @param file 浏览器 File 对象（来自 <input type="file"> 或 drag-drop）
 * @throws ProgressApiError
 */
export async function uploadFile(file: File): Promise<FileMetadata> {
  const fd = new FormData();
  fd.append('file', file);

  // 内联函数：拿当前 token 发起单次 fetch（refresh 后用新 token 再发要用同一个函数）
  const send = async (): Promise<Response> => {
    const token = getAccessToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`${getBaseUrl()}/api/files`, {
      method: 'POST',
      body: fd,
      headers, // 不设置 Content-Type，浏览器自带 boundary
    });
  };

  // 第一次发；401 时复用 apiFetch 同款 silent refresh + retry 一次（避免直接 logout）
  let res = await send();
  if (res.status === 401) {
    const refreshed = await silentRefreshOnce();
    if (refreshed) res = await send();
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const env = parseErrorEnvelope(body);
    throw new ProgressApiError(
      res.status,
      env.code,
      env.message,
      env.details,
    );
  }

  // 成功：剥 DataEnvelope.data 后 zod 校验
  const envelope = z.object({ data: FileMetadataSchema }).safeParse(body);
  if (!envelope.success) {
    throw new ProgressApiError(
      res.status,
      'schema_drift',
      'Upload response schema mismatch',
      envelope.error.issues,
    );
  }
  return envelope.data.data;
}

/**
 * 解析后端 ErrorEnvelope；解析失败回 'unknown'。
 */
function parseErrorEnvelope(body: unknown): {
  code: string;
  message: string;
  details?: unknown;
} {
  const schema = z.object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  });
  const parsed = schema.safeParse(body);
  if (parsed.success) {
    return parsed.data.error;
  }
  return { code: 'unknown', message: 'Unknown error', details: body };
}

// ============================================================
// 下载 URL 构造（流式响应，apiFetch 不适用）
// ============================================================

/**
 * 构造下载 URL（含查询参数携带的 access token）。
 *
 * 业务背景：
 * - 浏览器原生下载（<a href> 或 window.open）不会附 Authorization header
 * - 后端 oas 路径用 Bearer 鉴权，通过 query string 携带 token 是 v1 临时方案
 * - 长期应走"短期下载票据"模式（参考 ws_ticket）；当前 plan 不在 W7 范围
 *
 * 注：当前实现仅返回 URL 字符串；实际 token 注入由调用方决定（fetch+Bearer / 跳转 / iframe）。
 */
export function buildDownloadURL(fileId: number): string {
  return `${getBaseUrl()}/api/files/${fileId}`;
}

/**
 * 通过 fetch 流式下载文件并触发浏览器保存（绕过 <a download> 不带 token 的限制）。
 *
 * 业务流程：
 *   1. fetch 带 Authorization header
 *   2. 读取 blob → 创建 ObjectURL → 触发 <a> 点击 → revoke URL
 *   3. 文件名优先取 Content-Disposition；失败回退到调用方传的 fallbackName
 */
export async function downloadFile(fileId: number, fallbackName: string): Promise<void> {
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(buildDownloadURL(fileId), { headers });
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const env = parseErrorEnvelope(body);
    throw new ProgressApiError(res.status, env.code, env.message, env.details);
  }

  // 解析 Content-Disposition 拿 filename*=UTF-8'' 编码值（§C5 响应头）
  const cd = res.headers.get('Content-Disposition') ?? '';
  const filename = parseContentDispositionFilename(cd) ?? fallbackName;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 解析 Content-Disposition 中的 filename / filename*=UTF-8'' 字段。
 *
 * 规则（与 RFC 5987 + RFC 6266 一致）：
 *   - 优先取 filename*=UTF-8''<percent-encoded>，做 decodeURIComponent
 *   - 回退到 filename="..."（ASCII fallback）
 *   - 都没有 → 返回 null
 */
export function parseContentDispositionFilename(cd: string): string | null {
  // filename*=UTF-8''<encoded>
  const utf8Match = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      // 不合法 percent-encoding：忽略走 ASCII fallback
    }
  }
  // filename="..."
  const asciiMatch = cd.match(/filename="([^"]+)"/i);
  if (asciiMatch?.[1]) {
    return asciiMatch[1];
  }
  return null;
}

// ============================================================
// 列表 / 创建 endpoint
// ============================================================

/** 列出项目附件（sample_doc + source_code）。 */
export async function listProjectFiles(projectId: number): Promise<ProjectFile[]> {
  return apiFetch(
    `/api/projects/${projectId}/files`,
    { method: 'GET' },
    ProjectFileListSchema,
  );
}

/** 列出项目论文版本（version_no 倒序）。 */
export async function listThesisVersions(projectId: number): Promise<ThesisVersion[]> {
  return apiFetch(
    `/api/projects/${projectId}/thesis-versions`,
    { method: 'GET' },
    ThesisVersionListSchema,
  );
}

/** 创建论文新版（version_no 自动递增，永不覆盖）。 */
export async function createThesisVersion(
  projectId: number,
  fileId: number,
  remark?: string,
): Promise<ThesisVersion> {
  return apiFetch(
    `/api/projects/${projectId}/thesis-versions`,
    {
      method: 'POST',
      body: JSON.stringify({
        fileId,
        ...(remark !== undefined ? { remark } : {}),
      }),
    },
    ThesisVersionSchema,
  );
}
