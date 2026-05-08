/**
 * @file sanitize.test.ts
 * @description sanitize wrapper 单测，验证 DOMPurify 正确过滤危险 HTML
 * @author Atlas.oi
 * @date 2026-05-08
 */
import { describe, it, expect } from 'vitest';
import { sanitizeUserHtml } from '../sanitize';

describe('sanitizeUserHtml', () => {
  it('删除 script 标签', () => {
    const dirty = '<p>hello</p><script>alert(1)</script>';
    expect(sanitizeUserHtml(dirty)).toBe('<p>hello</p>');
  });

  it('删除 onerror 等事件 handler attribute', () => {
    const dirty = '<img src=x onerror="alert(1)">';
    const clean = sanitizeUserHtml(dirty);
    expect(clean).not.toContain('onerror');
    expect(clean).not.toContain('alert');
  });

  it('删除 javascript: scheme href', () => {
    const dirty = '<a href="javascript:alert(1)">click</a>';
    const clean = sanitizeUserHtml(dirty);
    expect(clean).not.toContain('javascript:');
  });

  it('保留 table/td/tr 用于 Excel 渲染', () => {
    // 注：HTML5 parser 规范在 <table><tr> 之间自动插入 <tbody>，jsdom/浏览器都会这么做
    // 这是 DOM 解析正常行为，不影响渲染结果，只断言 table 结构关键节点存在即可
    const dirty = '<table><tr><td>cell</td></tr></table>';
    const clean = sanitizeUserHtml(dirty);
    expect(clean).toContain('<table>');
    expect(clean).toContain('<tr>');
    expect(clean).toContain('<td>cell</td>');
    expect(clean).toContain('</table>');
  });

  it('保留 img blob: 与 data: src 用于 Word 内嵌图片', () => {
    const blob = '<img src="blob:http://localhost/abc">';
    const data = '<img src="data:image/png;base64,iVBORw0KGgo=">';
    expect(sanitizeUserHtml(blob)).toContain('blob:');
    expect(sanitizeUserHtml(data)).toContain('data:image/png');
  });

  it('删除 SVG 内的 onload', () => {
    const dirty = '<svg onload="alert(1)"><circle r=10/></svg>';
    const clean = sanitizeUserHtml(dirty);
    expect(clean).not.toContain('onload');
  });

  // ============================================================
  // 安全 review C2：style declaration 黑名单（防 clickjacking 全屏覆盖）
  // ============================================================

  it('删除 style 中的 position 属性（防绝对定位全屏覆盖）', () => {
    const dirty = '<div style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:99999;background:#000">遮罩</div>';
    const clean = sanitizeUserHtml(dirty);
    expect(clean).not.toMatch(/position\s*:/i);
    expect(clean).not.toMatch(/top\s*:/i);
    expect(clean).not.toMatch(/left\s*:/i);
    expect(clean).not.toMatch(/z-index/i);
  });

  it('删除 style 中视口单位的 width/height（防 100vw/100vh 全屏）', () => {
    const dirty = '<div style="width:100vw;height:100vh;background:red">x</div>';
    const clean = sanitizeUserHtml(dirty);
    expect(clean).not.toMatch(/100\s*vw/i);
    expect(clean).not.toMatch(/100\s*vh/i);
  });

  it('删除 style 中的 pointer-events（防点击穿透到下层）', () => {
    const dirty = '<div style="pointer-events:none">透明遮罩</div>';
    const clean = sanitizeUserHtml(dirty);
    expect(clean).not.toMatch(/pointer-events/i);
  });

  it('删除 style 中的 transform（防屏外平移伪装）', () => {
    const dirty = '<div style="transform:translateX(-9999px)">hidden</div>';
    const clean = sanitizeUserHtml(dirty);
    expect(clean).not.toMatch(/transform\s*:/i);
  });

  it('保留 style 中安全的排版属性（color/font/border 等供 docx-preview 渲染）', () => {
    const dirty = '<p style="color:red;font-size:14px;border:1px solid #000;text-align:center">text</p>';
    const clean = sanitizeUserHtml(dirty);
    expect(clean).toMatch(/color/i);
    expect(clean).toMatch(/font-size/i);
    expect(clean).toMatch(/border/i);
    expect(clean).toMatch(/text-align/i);
  });

  it('全部 declaration 都危险时整个 style 属性被移除', () => {
    const dirty = '<div style="position:fixed;z-index:9999">x</div>';
    const clean = sanitizeUserHtml(dirty);
    // 攻击 attr 全删后不应有 style="" 残留
    expect(clean).not.toMatch(/style\s*=/i);
  });
});
