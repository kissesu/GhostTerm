/**
 * @file fieldDefs.test.ts
 * @description 37 语义字段定义测试（T2.1 新增 table_header / T2.2 拆分 toc_entry 为 l1/l2/l3 / T2.3 新增 formula_block / T2.4 新增 footnote）
 *   验证 FIELD_DEFS 数组完整性、顺序、查找函数正确性
 * @author Atlas.oi
 * @date 2026-04-27
 */
import { describe, it, expect } from 'vitest';
import { FIELD_DEFS, getField, applicableAttrs } from '../templates/fieldDefs';

describe('FIELD_DEFS', () => {
  it('共 37 个字段', () => {
    // T2.4 新增 footnote 后总数由 36 升为 37
    expect(FIELD_DEFS).toHaveLength(37);
  });

  it('order 严格连续 1-37', () => {
    const orders = FIELD_DEFS.map((f) => f.order);
    expect(orders).toEqual(Array.from({ length: 37 }, (_, i) => i + 1));
  });

  it('所有 id 唯一', () => {
    const ids = FIELD_DEFS.map((f) => f.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(37);
  });

  it('分组只含合法值', () => {
    const validGroups = new Set(['front', 'body', 'back', 'global']);
    FIELD_DEFS.forEach((f) => {
      expect(validGroups.has(f.group)).toBe(true);
    });
  });

  it('前置部分 14 个（order 1-14，T2.2 拆分 toc_entry 为 l1/l2/l3）', () => {
    // T2.2 新增 toc_entry_l1/l2/l3，前置部分由 12 升为 14
    const front = FIELD_DEFS.filter((f) => f.group === 'front');
    expect(front).toHaveLength(14);
    expect(front[0].order).toBe(1);
    expect(front[13].order).toBe(14);
  });

  it('toc_entry 已删除', () => {
    // T2.2: 旧的合并字段不再存在
    expect(getField('toc_entry')).toBeUndefined();
  });

  it('toc_entry_l1 在前置部分且 order=12', () => {
    const f = getField('toc_entry_l1');
    expect(f).toBeDefined();
    expect(f?.group).toBe('front');
    expect(f?.order).toBe(12);
    expect(f?.label).toBe('目录一级条目');
    expect(f?.applicable_attributes).toEqual(['font.cjk', 'font.size_pt', 'font.bold', 'para.first_line_indent_chars']);
  });

  it('toc_entry_l2 在前置部分且 order=13', () => {
    const f = getField('toc_entry_l2');
    expect(f?.group).toBe('front');
    expect(f?.order).toBe(13);
    expect(f?.label).toBe('目录二级条目');
  });

  it('toc_entry_l3 在前置部分且 order=14', () => {
    const f = getField('toc_entry_l3');
    expect(f?.group).toBe('front');
    expect(f?.order).toBe(14);
    expect(f?.label).toBe('目录三级条目');
  });

  it('toc_entry_l1/l2/l3 共享相同的 applicable_attributes', () => {
    // 同语义不同级别的字段共享 attr 集是合理设计
    const l1 = getField('toc_entry_l1')?.applicable_attributes;
    const l2 = getField('toc_entry_l2')?.applicable_attributes;
    const l3 = getField('toc_entry_l3')?.applicable_attributes;
    expect(l1).toEqual(l2);
    expect(l2).toEqual(l3);
  });

  it('正文部分 11 个（order 15-25，T2.4 新增 footnote）', () => {
    // T2.4 在 body 末尾插入 footnote，正文部分由 10 升为 11
    const body = FIELD_DEFS.filter((f) => f.group === 'body');
    expect(body).toHaveLength(11);
    expect(body[0].order).toBe(15);
    expect(body[10].order).toBe(25);
  });

  it('chapter_title order 已升至 15', () => {
    // T2.2: chapter_title 由 13 → 15
    expect(getField('chapter_title')?.order).toBe(15);
  });

  it('table_header 在正文部分且 order=22', () => {
    // T2.2 后 table_header 由 20 → 22
    const f = getField('table_header');
    expect(f).toBeDefined();
    expect(f?.group).toBe('body');
    expect(f?.order).toBe(22);
    // T3.2: table_header 追加 4 个 table.* attr 后共 8 个
    expect(f?.applicable_attributes).toEqual([
      'font.cjk', 'font.size_pt', 'font.bold', 'para.align',
      'table.is_three_line', 'table.border_top_pt', 'table.border_bottom_pt', 'table.header_border_pt',
    ]);
  });

  it('table_inner_text order 已升至 23', () => {
    // T2.2 后 table_inner_text 由 21 → 23
    expect(getField('table_inner_text')?.order).toBe(23);
  });

  it('formula_block 在正文部分且 order=24', () => {
    // T2.3: 公式字段插在 body 末尾
    const f = getField('formula_block');
    expect(f).toBeDefined();
    expect(f?.group).toBe('body');
    expect(f?.order).toBe(24);
    expect(f?.label).toBe('公式');
    expect(f?.applicable_attributes).toEqual(['para.align']);
  });

  it('后置部分 6 个（order 26-31，T2.4 后整体 +1）', () => {
    const back = FIELD_DEFS.filter((f) => f.group === 'back');
    expect(back).toHaveLength(6);
    expect(back[0].order).toBe(26);
    expect(back[5].order).toBe(31);
  });

  it('全局部分 6 个（order 32-37，T2.4 后整体 +1）', () => {
    const global = FIELD_DEFS.filter((f) => f.group === 'global');
    expect(global).toHaveLength(6);
    expect(global[0].order).toBe(32);
    expect(global[5].order).toBe(37);
  });

  it('footnote 在正文部分且 order=25', () => {
    // T2.4: 脚注字段插在 body 末尾
    const f = getField('footnote');
    expect(f).toBeDefined();
    expect(f?.group).toBe('body');
    expect(f?.order).toBe(25);
    expect(f?.label).toBe('脚注');
    expect(f?.applicable_attributes).toEqual(['font.cjk', 'font.size_pt']);
  });

  it('mixed_script_global order 已升至 37', () => {
    // T2.4 后末位字段 order 由 36 → 37
    expect(getField('mixed_script_global')?.order).toBe(37);
  });
});

describe('getField', () => {
  it('返回正确的字段定义', () => {
    const f = getField('abstract_zh_title');
    expect(f?.label).toBe('中文「摘要」标题');
    expect(f?.group).toBe('front');
    expect(f?.order).toBe(2);
  });

  it('不存在的 id 返回 undefined', () => {
    expect(getField('nonexistent_field')).toBeUndefined();
  });
});

describe('applicableAttrs', () => {
  it('title_zh 包含 font.cjk 和 content.char_count_max', () => {
    const attrs = applicableAttrs('title_zh');
    expect(attrs).toContain('font.cjk');
    expect(attrs).toContain('content.char_count_max');
  });

  it('title_en 包含 font.ascii 但不含 font.cjk', () => {
    const attrs = applicableAttrs('title_en');
    expect(attrs).toContain('font.ascii');
    expect(attrs).not.toContain('font.cjk');
  });

  it('reference_entry 包含 citation.style', () => {
    const attrs = applicableAttrs('reference_entry');
    expect(attrs).toContain('citation.style');
    expect(attrs).toContain('para.hanging_indent_chars');
  });

  it('page_footer_number 包含分页格式属性', () => {
    const attrs = applicableAttrs('page_footer_number');
    expect(attrs).toContain('pagination.front_style');
    expect(attrs).toContain('pagination.body_style');
  });

  it('不存在的字段返回空数组', () => {
    expect(applicableAttrs('ghost_field')).toEqual([]);
  });
});
