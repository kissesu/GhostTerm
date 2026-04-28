/**
 * @file formatFieldValue.test.ts
 * @description formatFieldValue 单元测试：字号中文名、cjk/ascii 合并、多属性联合场景
 *              T3.1: 新增 6 个 attr key 中文片段输出测试
 * @author Atlas.oi
 * @date 2026-04-28
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

  // ── T3.1: 新增 6 个 attr key 中文片段输出 ──────────────────
  it('para.space_before_pt → 段前 Xpt', () => {
    const result = formatFieldValue({ 'para.space_before_pt': 12 });
    expect(result).toContain('段前 12pt');
  });

  it('para.space_after_pt → 段后 Xpt', () => {
    const result = formatFieldValue({ 'para.space_after_pt': 6 });
    expect(result).toContain('段后 6pt');
  });

  it('page.margin_gutter_cm → 装订线 Xcm', () => {
    const result = formatFieldValue({ 'page.margin_gutter_cm': 0.5 });
    expect(result).toContain('装订线 0.5cm');
  });

  it('page.header_offset_cm → 页眉距边界 Xcm', () => {
    const result = formatFieldValue({ 'page.header_offset_cm': 1.5 });
    expect(result).toContain('页眉距边界 1.5cm');
  });

  it('page.footer_offset_cm → 页脚距边界 Xcm', () => {
    const result = formatFieldValue({ 'page.footer_offset_cm': 1.75 });
    expect(result).toContain('页脚距边界 1.75cm');
  });

  it('page.print_mode double → 双面打印', () => {
    const result = formatFieldValue({ 'page.print_mode': 'double' });
    expect(result).toContain('双面打印');
  });

  it('page.print_mode single → 单面打印', () => {
    const result = formatFieldValue({ 'page.print_mode': 'single' });
    expect(result).toContain('单面打印');
  });

  // ── T3.2: table.* namespace attr 中文片段输出 ──────────────────
  it('table.is_three_line true → 三线表', () => {
    const result = formatFieldValue({ 'table.is_three_line': true });
    expect(result).toContain('三线表');
  });

  it('table.is_three_line false → 空串（不显示负向描述）', () => {
    const result = formatFieldValue({ 'table.is_three_line': false });
    expect(result).toBe('');
  });

  it('table.border_top_pt → 表格上线 Xpt', () => {
    const result = formatFieldValue({ 'table.border_top_pt': 1.5 });
    expect(result).toContain('表格上线 1.5pt');
  });

  it('table.border_bottom_pt → 表格下线 Xpt', () => {
    const result = formatFieldValue({ 'table.border_bottom_pt': 1.5 });
    expect(result).toContain('表格下线 1.5pt');
  });

  it('table.header_border_pt → 表头下线 Xpt', () => {
    const result = formatFieldValue({ 'table.header_border_pt': 0.5 });
    expect(result).toContain('表头下线 0.5pt');
  });

  // ── T3.3: numbering.* namespace attr 中文片段输出 ──────────────────
  it('numbering.figure_style continuous → 图编号：连续', () => {
    const result = formatFieldValue({ 'numbering.figure_style': 'continuous' });
    expect(result).toContain('图编号：连续');
  });

  it('numbering.figure_style chapter_based → 图编号：章节式', () => {
    const result = formatFieldValue({ 'numbering.figure_style': 'chapter_based' });
    expect(result).toContain('图编号：章节式');
  });

  it('numbering.subfigure_style a_b_c → 分图 (a)(b)(c)', () => {
    const result = formatFieldValue({ 'numbering.subfigure_style': 'a_b_c' });
    expect(result).toContain('分图 (a)(b)(c)');
  });

  it('numbering.subfigure_style 1_2_3 → 分图 .1/.2/.3', () => {
    const result = formatFieldValue({ 'numbering.subfigure_style': '1_2_3' });
    expect(result).toContain('分图 .1/.2/.3');
  });

  it('numbering.formula_style continuous → 公式：连续', () => {
    const result = formatFieldValue({ 'numbering.formula_style': 'continuous' });
    expect(result).toContain('公式：连续');
  });

  it('numbering.formula_style chapter_based → 公式：章节式', () => {
    const result = formatFieldValue({ 'numbering.formula_style': 'chapter_based' });
    expect(result).toContain('公式：章节式');
  });
});
