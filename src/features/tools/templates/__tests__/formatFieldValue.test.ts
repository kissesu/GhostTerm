/**
 * @file formatFieldValue.test.ts
 * @description formatFieldValue 单元测试：字号中文名、cjk/ascii 合并、多属性联合场景
 * @author Atlas.oi
 * @date 2026-04-18
 */
import { describe, it, expect } from 'vitest';
import { formatFieldValue } from '../formatFieldValue';

describe('formatFieldValue', () => {
  // ── 边界情况 ──────────────────────────────────────────────
  it('空对象返回空串', () => {
    expect(formatFieldValue({})).toBe('');
  });

  it('undefined 返回空串', () => {
    expect(formatFieldValue(undefined)).toBe('');
  });

  // ── font.size_pt 中文字号名 ───────────────────────────────
  it('标准字号 12pt → 小四（无 pt 后缀）', () => {
    const result = formatFieldValue({ 'font.size_pt': 12 });
    expect(result).toContain('小四');
    expect(result).not.toContain('pt');
  });

  it('非标准字号 11.5pt → 保留 pt 后缀', () => {
    const result = formatFieldValue({ 'font.size_pt': 11.5 });
    expect(result).toContain('11.5pt');
  });

  // ── cjk / ascii 合并显示 ──────────────────────────────────
  it('cjk 和 ascii 相同 → 中西文 {value}，不出现重复', () => {
    const result = formatFieldValue({ 'font.cjk': '宋体', 'font.ascii': '宋体' });
    // 合并后应显示"中西文 宋体"
    expect(result).toContain('中西文 宋体');
    // 不应出现"宋体 · 宋体"的重复形式
    expect(result).not.toContain('宋体 · 宋体');
  });

  it('cjk 和 ascii 不同 → 分别显示中/西前缀', () => {
    const result = formatFieldValue({ 'font.cjk': '宋体', 'font.ascii': 'Times New Roman' });
    expect(result).toContain('中 宋体');
    expect(result).toContain('西 Times New Roman');
  });

  it('只有 cjk → 中 {value}', () => {
    const result = formatFieldValue({ 'font.cjk': '宋体' });
    expect(result).toContain('中 宋体');
  });

  it('只有 ascii → 西 {value}', () => {
    const result = formatFieldValue({ 'font.ascii': 'Times' });
    expect(result).toContain('西 Times');
  });

  // ── 多属性联合场景 ─────────────────────────────────────────
  it('多属性：cjk + size_pt + bold + align 全部正确格式化', () => {
    const result = formatFieldValue({
      'font.cjk': '宋体',
      'font.size_pt': 14,
      'font.bold': true,
      'para.align': 'center',
    });
    // 14pt = 四号
    expect(result).toContain('中 宋体');
    expect(result).toContain('四号');
    expect(result).toContain('加粗');
    expect(result).toContain('居中');
    // 各片段用" · "连接
    expect(result).toContain(' · ');
  });
});
