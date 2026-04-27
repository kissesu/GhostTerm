/**
 * @file fieldDefs.ts
 * @description 37 个论文语义字段定义（前端镜像 src-python/thesis_worker/engine_v2/field_defs.py）
 *   每个字段包含：唯一 ID、中文标签、分组、顺序号、适用属性列表。
 *   适用属性列表决定该字段在模板编辑器中可配置哪些规则。
 *   T2.1: 新增 table_header(order=20)，将 table_inner_text 推至 order=21，后续字段全部 +1。
 *   T2.2: 删除 toc_entry(12)，拆分为 toc_entry_l1(12)/l2(13)/l3(14)；
 *         因一/二/三级目录条目缩进量各异，合并字段无法独立表达约束；
 *         后续字段全部 +2（chapter_title 13→15，...，mixed_script_global 33→35）。
 *   T2.3: 新增 formula_block(order=24)，理工科公式格式独立可校验；
 *         applicable_attributes 本 task 只含 para.align，numbering.formula_style 等 T3.3 再补；
 *         后续字段全部 +1（references_title 24→25，...，mixed_script_global 35→36）。
 *   T2.4: 新增 footnote(order=25)，spec1 规定脚注宋体小五号，属于独立版面元素；
 *         applicable_attributes 仅 font.cjk + font.size_pt；
 *         后续字段全部 +1（references_title 25→26，...，mixed_script_global 36→37）。
 *   T3.1: 补齐 B 类 6 个高频缺失 attr key：
 *         chapter_title + toc_title 追加 para.space_before_pt / para.space_after_pt；
 *         page_margin 追加 page.margin_gutter_cm / page.header_offset_cm /
 *         page.footer_offset_cm / page.print_mode（并入而非新建字段）。
 * @author Atlas.oi
 * @date 2026-04-28
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
  // 前置部分（order 1-14）
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
    // T3.1: 追加 para.space_before_pt / para.space_after_pt（与 _lines 系列共存）
    applicable_attributes: ['font.cjk', 'font.size_pt', 'font.bold', 'para.align', 'para.space_before_lines', 'para.space_after_lines', 'para.space_before_pt', 'para.space_after_pt'],
  },
  {
    // T2.2: 从 toc_entry 拆出一级目录条目独立字段。
    // spec3 规定一级条目黑体四号顶格，与二/三级条目缩进量各异，
    // 合并为单一 toc_entry 无法分级表达独立的缩进约束。
    id: 'toc_entry_l1',
    label: '目录一级条目',
    group: 'front',
    order: 12,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'font.bold', 'para.first_line_indent_chars'],
  },
  {
    // T2.2: 二级目录条目（宋体小四，右缩进 2 字符）
    id: 'toc_entry_l2',
    label: '目录二级条目',
    group: 'front',
    order: 13,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'font.bold', 'para.first_line_indent_chars'],
  },
  {
    // T2.2: 三级目录条目（宋体小四，右缩进 4 字符）
    id: 'toc_entry_l3',
    label: '目录三级条目',
    group: 'front',
    order: 14,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'font.bold', 'para.first_line_indent_chars'],
  },

  // ────────────────────────────────────────────
  // 正文部分（order 15-25）
  // 各级标题、正文段落、图表及说明
  // T2.2 后 order 由原 13-21 整体 +2
  // ────────────────────────────────────────────
  {
    id: 'chapter_title',
    label: '一级章节标题',
    group: 'body',
    order: 15,
    // T3.1: 追加 para.space_before_pt / para.space_after_pt（与 _lines 系列共存，
    // 规范文本描述"磅"时用 _pt，描述"行"时用 _lines，两者互不冲突）
    applicable_attributes: ['font.cjk', 'font.size_pt', 'font.bold', 'para.align', 'para.space_before_lines', 'para.space_after_lines', 'para.space_before_pt', 'para.space_after_pt', 'page.new_page_before'],
  },
  {
    id: 'section_title',
    label: '二级章节标题',
    group: 'body',
    order: 16,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'font.bold', 'para.align'],
  },
  {
    id: 'subsection_title',
    label: '三级章节标题',
    group: 'body',
    order: 17,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'para.align'],
  },
  {
    id: 'body_para',
    label: '正文段落',
    group: 'body',
    order: 18,
    applicable_attributes: ['font.cjk', 'font.ascii', 'font.size_pt', 'para.first_line_indent_chars', 'para.line_spacing', 'mixed_script.ascii_is_tnr'],
  },
  {
    id: 'figure_caption',
    label: '图题',
    group: 'body',
    order: 19,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'para.align', 'layout.position'],
  },
  {
    id: 'figure_inner_text',
    label: '图内文字/图例',
    group: 'body',
    order: 20,
    applicable_attributes: ['font.cjk', 'font.size_pt'],
  },
  {
    id: 'table_caption',
    label: '表题',
    group: 'body',
    order: 21,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'para.align', 'layout.position'],
  },
  {
    // T2.1: 从 table_inner_text 拆出表头行独立字段。
    // 规范层对表头（首行格式/下边框线）与表内容（小五宋体）是分开规定的两件事，
    // 合并为 table_inner_text 会导致规范校验无法区分两者。
    // T2.2 后 order 由 20 → 22
    id: 'table_header',
    label: '表头',
    group: 'body',
    order: 22,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'font.bold', 'para.align'],
  },
  {
    id: 'table_inner_text',
    label: '表内容',
    group: 'body',
    order: 23,
    applicable_attributes: ['font.cjk', 'font.size_pt'],
  },

  {
    // T2.3: 新增公式字段。理工科规范对公式格式规定详细（居中另起一行、编号圆括号靠右、
    // 等号处转行），属于独立可校验的版面元素，合并在 body_para 无法单独施加约束。
    // applicable_attributes 本 task 只加 para.align；
    // numbering.formula_style 等 T3.3 新增 numbering namespace 时再补。
    id: 'formula_block',
    label: '公式',
    group: 'body',
    order: 24,
    applicable_attributes: ['para.align'],
  },
  {
    // T2.4: 新增脚注字段。spec1 规定"注释列于当前页脚注位置，宋体小五号"，
    // 属于独立版面元素，规范只规定字体和字号两个维度，
    // applicable_attributes 仅 font.cjk + font.size_pt。
    id: 'footnote',
    label: '脚注',
    group: 'body',
    order: 25,
    applicable_attributes: ['font.cjk', 'font.size_pt'],
  },

  // ────────────────────────────────────────────
  // 后置部分（order 26-31）
  // 参考文献、致谢、附录
  // T2.4 后 order 由原 25-30 整体 +1
  // ────────────────────────────────────────────
  {
    id: 'references_title',
    label: '参考文献标题',
    group: 'back',
    order: 26,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'font.bold', 'para.align', 'page.new_page_before'],
  },
  {
    id: 'reference_entry',
    label: '参考文献条目',
    group: 'back',
    order: 27,
    applicable_attributes: ['font.cjk', 'font.ascii', 'font.size_pt', 'para.hanging_indent_chars', 'citation.style'],
  },
  {
    id: 'ack_title',
    label: '致谢标题',
    group: 'back',
    order: 28,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'font.bold', 'para.align', 'para.letter_spacing_chars', 'page.new_page_before'],
  },
  {
    id: 'ack_body',
    label: '致谢正文',
    group: 'back',
    order: 29,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'para.first_line_indent_chars'],
  },
  {
    id: 'appendix_title',
    label: '附录标题',
    group: 'back',
    order: 30,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'font.bold', 'para.align', 'para.letter_spacing_chars', 'page.new_page_before'],
  },
  {
    id: 'appendix_body',
    label: '附录正文',
    group: 'back',
    order: 31,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'para.first_line_indent_chars'],
  },

  // ────────────────────────────────────────────
  // 页面级全局（order 32-37）
  // 页面尺寸、边距、页眉页脚、全文行距、混排字体
  // T2.4 后 order 由原 31-36 整体 +1
  // ────────────────────────────────────────────
  {
    id: 'page_size',
    label: '页面大小',
    group: 'global',
    order: 32,
    applicable_attributes: ['page.size'],
  },
  {
    id: 'page_margin',
    label: '页边距',
    group: 'global',
    order: 33,
    // T3.1: 追加装订线/页眉距/页脚距/打印模式 4 项，并入而非新建字段
    applicable_attributes: [
      'page.margin_top_cm', 'page.margin_bottom_cm', 'page.margin_left_cm', 'page.margin_right_cm',
      'page.margin_gutter_cm', 'page.header_offset_cm', 'page.footer_offset_cm', 'page.print_mode',
    ],
  },
  {
    id: 'page_header',
    label: '页眉',
    group: 'global',
    order: 34,
    applicable_attributes: ['font.cjk', 'font.size_pt', 'para.align', 'content.specific_text'],
  },
  {
    id: 'page_footer_number',
    label: '页脚页码',
    group: 'global',
    order: 35,
    applicable_attributes: ['font.ascii', 'font.size_pt', 'para.align', 'pagination.front_style', 'pagination.body_style'],
  },
  {
    id: 'line_spacing_global',
    label: '全文行距',
    group: 'global',
    order: 36,
    applicable_attributes: ['para.line_spacing'],
  },
  {
    id: 'mixed_script_global',
    label: '数字/西文字体全局',
    group: 'global',
    order: 37,
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
