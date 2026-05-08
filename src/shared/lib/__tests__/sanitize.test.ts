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
});
