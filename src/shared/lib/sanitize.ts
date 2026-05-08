/**
 * @file sanitize.ts
 * @description DOMPurify 包装器，给 dangerouslySetInnerHTML 渲染用户文件 HTML 时统一过 sanitize
 * @author Atlas.oi
 * @date 2026-05-08
 */
import DOMPurify from 'isomorphic-dompurify';

// 白名单标签：覆盖 SheetJS sheet_to_html 的 table 系列 + docx-preview 的常规文档结构
const ALLOWED_TAGS = [
  'p', 'br', 'span', 'div', 'strong', 'em', 'u', 'i', 'b',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'td', 'th', 'caption', 'colgroup', 'col',
  'a', 'img',
  'pre', 'code',
  'hr',
];

// 白名单属性：保留排版与媒体源属性，data-* 兼容 SheetJS / docx-preview 自定义数据
const ALLOWED_ATTR = [
  'href', 'src', 'alt', 'title', 'class', 'style',
  'colspan', 'rowspan', 'span', 'width', 'height',
  'data-*',
];

// URI 协议白名单：放行 blob:/data:/https?:; 以及相对路径，禁止 javascript:/vbscript: 等执行型 scheme
const ALLOWED_URI_REGEXP = /^(?:(?:blob|data|https?):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

/**
 * 过 DOMPurify 清洗用户文件渲染产物（XLSX sheet_to_html, DOCX renderAsync 等）
 *
 * 业务用途：
 * 1. 阻止 <script> / on* 事件 / javascript: scheme 等 XSS 向量
 * 2. 保留 table 结构（Excel 表格）+ blob:/data: 图片（Word 内嵌图）
 * 3. 是 CSP script-src 'self' 之外的应用层第二层防御
 *
 * @param dirty 原始 HTML 字符串
 * @returns 清洗后安全可注入 dangerouslySetInnerHTML 的字符串
 */
export function sanitizeUserHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
  });
}
