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
// 注：style 仍在白名单，但 declaration 级走 sanitizeStyleAttr 黑名单（见下方 hook）
const ALLOWED_ATTR = [
  'href', 'src', 'alt', 'title', 'class', 'style',
  'colspan', 'rowspan', 'span', 'width', 'height',
  'data-*',
];

// URI 协议白名单：放行 blob:/data:/https?:; 以及相对路径，禁止 javascript:/vbscript: 等执行型 scheme
const ALLOWED_URI_REGEXP = /^(?:(?:blob|data|https?):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

// ===========================================================================
// 安全 review C2：style 属性 declaration 级黑名单
// ---------------------------------------------------------------------------
// 仅允许 style 属性整体存在不够，必须按 declaration 过滤危险 CSS：
// 攻击场景：恶意 .docx/.xlsx 在内容里塞
//   <div style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:99999">遮罩</div>
// 通过 sanitize 后注入 dangerouslySetInnerHTML 全屏覆盖 webview 实施 clickjacking。
// 设计取舍：
//   - 不删 style 整体：docx-preview 重度依赖 inline style 重排版（字体/边框/对齐），
//     全部丢会破渲染 → 改 declaration 级黑名单只丢攻击性属性，保排版。
//   - 黑名单覆盖：position 全部值（fixed/absolute/sticky 都可能配合 top/left 覆盖）、
//     top/left/right/bottom（绝对定位时全屏锚点）、z-index（覆盖层叠）、
//     pointer-events（点击穿透下层）、transform 系列（平移到屏外/伪造）、
//     视口尺寸 100vw/100vh（铺满 viewport）。
//   - 白名单更安全但 docx 排版几十种属性，黑名单实际更易维护。
// ===========================================================================
const DANGEROUS_STYLE_PROPS = new Set([
  'position', 'top', 'left', 'right', 'bottom',
  'z-index', 'pointer-events',
  'transform', '-webkit-transform', '-ms-transform', '-moz-transform',
]);

const VIEWPORT_UNIT_RE = /\d+\s*v[wh]/i;

/**
 * 过滤 style 属性中的危险 declaration，保留排版安全 prop。
 *
 * 例：'color:red;position:fixed;top:0;width:100vw' → 'color:red'
 */
function sanitizeStyleAttr(value: string): string {
  return value
    .split(';')
    .map((decl) => {
      const idx = decl.indexOf(':');
      if (idx < 0) return '';
      const prop = decl.slice(0, idx).trim().toLowerCase();
      if (!prop) return '';
      if (DANGEROUS_STYLE_PROPS.has(prop)) return '';
      const val = decl.slice(idx + 1).trim();
      // 视口单位攻击：width:100vw / height:100vh 之类铺满全屏
      if ((prop === 'width' || prop === 'height') && VIEWPORT_UNIT_RE.test(val)) return '';
      return `${prop}: ${val}`;
    })
    .filter(Boolean)
    .join('; ');
}

// DOMPurify hook 是全局共享的，模块加载时安装一次即可。
// 重复 addHook 会让同一逻辑被叠加调用，引入难调试的多次过滤副作用。
let styleHookInstalled = false;
function ensureStyleHookInstalled(): void {
  if (styleHookInstalled) return;
  DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
    if (data.attrName === 'style' && typeof data.attrValue === 'string') {
      data.attrValue = sanitizeStyleAttr(data.attrValue);
      // 过滤后若为空字符串，DOMPurify 仍保留 attr="" — 用 keepAttr=false 完全移除
      if (data.attrValue === '') {
        data.keepAttr = false;
      }
    }
  });
  styleHookInstalled = true;
}

/**
 * 过 DOMPurify 清洗用户文件渲染产物（XLSX sheet_to_html, DOCX renderAsync 等）
 *
 * 业务用途：
 * 1. 阻止 <script> / on* 事件 / javascript: scheme 等 XSS 向量
 * 2. 保留 table 结构（Excel 表格）+ blob:/data: 图片（Word 内嵌图）
 * 3. style 属性 declaration 级过滤防 clickjacking 全屏覆盖（C2）
 * 4. 是 CSP script-src 'self' 之外的应用层第二层防御
 *
 * @param dirty 原始 HTML 字符串
 * @returns 清洗后安全可注入 dangerouslySetInnerHTML 的字符串
 */
export function sanitizeUserHtml(dirty: string): string {
  ensureStyleHookInstalled();
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
  });
}
