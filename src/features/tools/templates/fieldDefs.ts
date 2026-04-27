/**
 * @file fieldDefs.ts
 * @description 33 个论文语义字段定义（前端镜像 src-python/thesis_worker/engine_v2/field_defs.py）
 *   每个字段包含：唯一 ID、中文标签、分组、顺序号、适用属性列表。
 *   适用属性列表决定该字段在模板编辑器中可配置哪些规则。
 *   T2.1: 新增 table_header(order=20)，将 table_inner_text 推至 order=21，后续字段全部 +1。
 * @author Atlas.oi
 * @date 2026-04-18
 */

export interface FieldDef {
  id: string;
  label: string;
  group: 'front' | 'body' | 'back' | 'global';
  order: number;
  applicable_attributes: string[];
}

export const FIELD_DEFS: FieldDef[] = [
  // ────────────────────────────────────────────
  // 前置部分（order 1-12）
  // 封面前的正式内容：标题、摘要、关键词、目录
  // ────────────────────────────────────────────
  {
    id: 'title_zh',
    label: '中文题目',
    group: 'front',
    order: 1,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'font.bold', 'para.align', 'content.char_count_max'],
  },
  {
    id: 'abstract_zh_title',
    label: '中文「摘要」标题',
    group: 'front',
    order: 2,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'font.bold', 'para.align', 'para.letter_spacing_chars', 'content.specific_text'],
  },
  {
    id: 'abstract_zh_body',
    label: '中文摘要正文',
    group: 'front',
    order: 3,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'para.first_line_indent_chars', 'para.line_spacing', 'content.char_count_min', 'content.char_count_max', 'mixed_script.ascii_is_tnr'],
  },
  {
    id: 'keywords_zh_label',
    label: '中文关键词标签',
    group: 'front',
    order: 4,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'font.bold', 'content.specific_text'],
  },
  {
    id: 'keywords_zh_content',
    label: '中文关键词内容',
    group: 'front',
    order: 5,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'content.item_count_min', 'content.item_count_max', 'content.item_separator'],
  },
  {
    id: 'title_en',
    label: '英文题目',
    group: 'front',
    order: 6,
    applicable_attributes: ['font.ascii', 'font.size_pt', 'font.bold', 'para.align'],
  },
  {
    id: 'abstract_en_title',
    label: '「Abstract」标题',
    group: 'front',
    order: 7,
    applicable_attributes: ['font.ascii', 'font.size_pt', 'font.bold', 'para.align', 'para.letter_spacing_chars', 'content.specific_text'],
  },
  {
    id: 'abstract_en_body',
    label: '英文摘要正文',
    group: 'front',
    order: 8,
    applicable_attributes: ['font.ascii', 'font.size_pt', 'para.first_line_indent_chars', 'para.line_spacing', 'content.char_count_min', 'content.char_count_max', 'mixed_script.ascii_is_tnr'],
  },
  {
    id: 'keywords_en_label',
    label: '「Key Words」标签',
    group: 'front',
    order: 9,
    applicable_attributes: ['font.ascii', 'font.size_pt', 'font.bold', 'content.specific_text'],
  },
  {
    id: 'keywords_en_content',
    label: '英文关键词内容',
    group: 'front',
    order: 10,
    applicable_attributes: ['font.ascii', 'font.size_pt', 'content.item_count_min', 'content.item_count_max', 'content.item_separator'],
  },
  {
    id: 'toc_title',
    label: '目录标题',
    group: 'front',
    order: 11,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'font.bold', 'para.align', 'para.space_before_lines', 'para.space_after_lines'],
  },
  {
    id: 'toc_entry',
    label: '目录条目',
    group: 'front',
    order: 12,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'para.first_line_indent_chars'],
  },

  // ────────────────────────────────────────────
  // 正文部分（order 13-21）
  // 各级标题、正文段落、图表及说明
  // ────────────────────────────────────────────
  {
    id: 'chapter_title',
    label: '一级章节标题',
    group: 'body',
    order: 13,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'font.bold', 'para.align', 'para.space_before_lines', 'para.space_after_lines', 'page.new_page_before'],
  },
  {
    id: 'section_title',
    label: '二级章节标题',
    group: 'body',
    order: 14,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'font.bold', 'para.align'],
  },
  {
    id: 'subsection_title',
    label: '三级章节标题',
    group: 'body',
    order: 15,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'para.align'],
  },
  {
    id: 'body_para',
    label: '正文段落',
    group: 'body',
    order: 16,
    applicable_attributes: ['font.cjk', 'font.ascii', 'font.size_pt', 'para.first_line_indent_chars', 'para.line_spacing', 'mixed_script.ascii_is_tnr'],
  },
  {
    id: 'figure_caption',
    label: '图题',
    group: 'body',
    order: 17,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'para.align', 'layout.position'],
  },
  {
    id: 'figure_inner_text',
    label: '图内文字/图例',
    group: 'body',
    order: 18,
    applicable_attributes: ['font.cjk', 'font.size_pt'],
  },
  {
    id: 'table_caption',
    label: '表题',
    group: 'body',
    order: 19,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'para.align', 'layout.position'],
  },
  {
    // T2.1: 从 table_inner_text 拆出表头行独立字段。
    // 规范层对表头（首行格式/下边框线）与表内容（小五宋体）是分开规定的两件事，
    // 合并为 table_inner_text 会导致规范校验无法区分两者。
    id: 'table_header',
    label: '表头',
    group: 'body',
    order: 20,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'font.bold', 'para.align'],
  },
  {
    id: 'table_inner_text',
    label: '表内容',
    group: 'body',
    order: 21,
    applicable_attributes: ['font.cjk', 'font.size_pt'],
  },

  // ────────────────────────────────────────────
  // 后置部分（order 22-27）
  // 参考文献、致谢、附录
  // ────────────────────────────────────────────
  {
    id: 'references_title',
    label: '参考文献标题',
    group: 'back',
    order: 22,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'font.bold', 'para.align', 'page.new_page_before'],
  },
  {
    id: 'reference_entry',
    label: '参考文献条目',
    group: 'back',
    order: 23,
    applicable_attributes: ['font.cjk', 'font.ascii', 'font.size_pt', 'para.hanging_indent_chars', 'citation.style'],
  },
  {
    id: 'ack_title',
    label: '致谢标题',
    group: 'back',
    order: 24,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'font.bold', 'para.align', 'para.letter_spacing_chars', 'page.new_page_before'],
  },
  {
    id: 'ack_body',
    label: '致谢正文',
    group: 'back',
    order: 25,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'para.first_line_indent_chars'],
  },
  {
    id: 'appendix_title',
    label: '附录标题',
    group: 'back',
    order: 26,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'font.bold', 'para.align', 'para.letter_spacing_chars', 'page.new_page_before'],
  },
  {
    id: 'appendix_body',
    label: '附录正文',
    group: 'back',
    order: 27,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'para.first_line_indent_chars'],
  },

  // ────────────────────────────────────────────
  // 页面级全局（order 28-33）
  // 页面尺寸、边距、页眉页脚、全文行距、混排字体
  // ────────────────────────────────────────────
  {
    id: 'page_size',
    label: '页面大小',
    group: 'global',
    order: 28,
    applicable_attributes: ['page.size'],
  },
  {
    id: 'page_margin',
    label: '页边距',
    group: 'global',
    order: 29,
    applicable_attributes: ['page.margin_top_cm', 'page.margin_bottom_cm', 'page.margin_left_cm', 'page.margin_right_cm'],
  },
  {
    id: 'page_header',
    label: '页眉',
    group: 'global',
    order: 30,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'para.align', 'content.specific_text'],
  },
  {
    id: 'page_footer_number',
    label: '页脚页码',
    group: 'global',
    order: 31,
    applicable_attributes: ['font.ascii', 'font.size_pt', 'para.align', 'pagination.front_style', 'pagination.body_style'],
  },
  {
    id: 'line_spacing_global',
    label: '全文行距',
    group: 'global',
    order: 32,
    applicable_attributes: ['para.line_spacing'],
  },
  {
    id: 'mixed_script_global',
    label: '数字/西文字体全局',
    group: 'global',
    order: 33,
    applicable_attributes: ['mixed_script.ascii_is_tnr', 'mixed_script.punct_space_after'],
  },
];

// 构建 id → FieldDef 快速查找表，避免每次 find() O(n) 遍历
const _FIELD_MAP: Record<string, FieldDef> = Object.fromEntries(
  FIELD_DEFS.map((f) => [f.id, f])
);

/**
 * 根据字段 ID 获取字段定义
 * @param fieldId 字段唯一标识
 * @returns 字段定义，不存在返回 undefined
 */
export function getField(fieldId: string): FieldDef | undefined {
  return _FIELD_MAP[fieldId];
}

/**
 * 获取字段的适用属性列表
 * @param fieldId 字段唯一标识
 * @returns 属性 key 数组，字段不存在时返回空数组
 */
export function applicableAttrs(fieldId: string): string[] {
  return _FIELD_MAP[fieldId]?.applicable_attributes ?? [];
}
