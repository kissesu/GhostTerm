/**
 * @file fieldDefs.test.ts
 * @description 33 语义字段定义测试（T2.1 新增 table_header 字段）
 *   验证 FIELD_DEFS 数组完整性、顺序、查找函数正确性
 * @author Atlas.oi
 * @date 2026-04-18
 */
import { describe, it, expect } from 'vitest';
import { FIELD_DEFS, getField, applicableAttrs } from '../templates/fieldDefs';

describe('FIELD_DEFS', () => {
  it('共 33 个字段', () => {
    // T2.1 新增 table_header 字段后总数由 32 升为 33
    expect(FIELD_DEFS).toHaveLength(33);
  });

  it('order 严格连续 1-33', () => {
    const orders = FIELD_DEFS.map((f) => f.order);
    expect(orders).toEqual(Array.from({ length: 33 }, (_, i) => i + 1));
  });

  it('所有 id 唯一', () => {
    const ids = FIELD_DEFS.map((f) => f.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(33);
  });

  it('分组只含合法值', () => {
    const validGroups = new Set(['front', 'body', 'back', 'global']);
    FIELD_DEFS.forEach((f) => {
      expect(validGroups.has(f.group)).toBe(true);
    });
  });

  it('前置部分 12 个（order 1-12）', () => {
    const front = FIELD_DEFS.filter((f) => f.group === 'front');
    expect(front).toHaveLength(12);
    expect(front[0].order).toBe(1);
    expect(front[11].order).toBe(12);
  });

  it('正文部分 9 个（order 13-21，T2.1 新增 table_header）', () => {
    // T2.1 新增 table_header(order=20)，正文部分由 8 字段升为 9 字段
    const body = FIELD_DEFS.filter((f) => f.group === 'body');
    expect(body).toHaveLength(9);
  });

  it('table_header 在正文部分且 order=20', () => {
    // T2.1 新增字段：表头与表内容拆分
    const f = getField('table_header');
    expect(f).toBeDefined();
    expect(f?.group).toBe('body');
    expect(f?.order).toBe(20);
    expect(f?.applicable_attributes).toEqual(['font.cjk', 'font.size_pt', 'font.bold', 'para.align']);
  });

  it('table_inner_text order 已升至 21', () => {
    // T2.1: table_header 插入后，table_inner_text 由 order=20 升为 order=21
    const f = getField('table_inner_text');
    expect(f?.order).toBe(21);
  });

  it('后置部分 6 个（order 22-27）', () => {
    const back = FIELD_DEFS.filter((f) => f.group === 'back');
    expect(back).toHaveLength(6);
  });

  it('全局部分 6 个（order 28-33）', () => {
    const global = FIELD_DEFS.filter((f) => f.group === 'global');
    expect(global).toHaveLength(6);
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
