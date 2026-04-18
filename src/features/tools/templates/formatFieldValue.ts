/**
 * @file formatFieldValue.ts
 * @description 将 sidecar 返回的字段 value（扁平 attrKey → primitive 的 map）
 *   翻译成人读中文字符串，用于 FieldList 展示"抓取到了什么规则约束"。
 *   例如 { "font.cjk": "宋体", "font.size_pt": 14, "font.bold": true } → "宋体 · 14pt · 加粗"
 * @author Atlas.oi
 * @date 2026-04-18
 */

// ────────────────────────────────────────────────────────
// 对齐值 → 中文标签
// ────────────────────────────────────────────────────────
const ALIGN_LABEL: Record<string, string> = {
  left: '左对齐',
  center: '居中',
  right: '右对齐',
  justify: '两端对齐',
};

// 页码样式 → 中文标签
const PAGE_STYLE_LABEL: Record<string, string> = {
  roman_lower: '小写罗马',
  roman_upper: '大写罗马',
  arabic: '阿拉伯数字',
  none: '无',
};

// 版面位置 → 中文标签
const LAYOUT_POSITION_LABEL: Record<string, string> = {
  above: '图/表上方',
  below: '图/表下方',
};

/**
 * 将单个属性 key + value 转为人读片段
 *
 * @param key   扁平属性键，如 'font.cjk' / 'para.line_spacing'
 * @param value 该属性对应的原始值（string/number/boolean）
 * @returns     人读片段，未识别的 key 退化为 `key=value`
 */
function formatAttr(key: string, value: unknown): string {
  // 空值/占位值过滤：防止把空字符串当有效约束
  if (value === undefined || value === null || value === '') return '';

  switch (key) {
    case 'font.cjk':
    case 'font.ascii':
      return String(value);
    case 'font.size_pt':
      return `${value}pt`;
    case 'font.bold':
      return value === true ? '加粗' : '';
    case 'para.align':
      return ALIGN_LABEL[String(value)] ?? String(value);
    case 'para.line_spacing':
      return `行距 ${value}`;
    case 'para.first_line_indent_chars':
      return `首行缩进 ${value} 字`;
    case 'para.hanging_indent_chars':
      return `悬挂缩进 ${value} 字`;
    case 'para.letter_spacing_chars':
      return `字距 ${value} 字`;
    case 'para.space_before_lines':
      return `段前 ${value} 行`;
    case 'para.space_after_lines':
      return `段后 ${value} 行`;
    case 'content.specific_text':
      return `文本「${value}」`;
    case 'content.max_chars':
      return `≤ ${value} 字`;
    case 'content.char_count_min':
      return `≥ ${value} 字`;
    case 'content.char_count_max':
      return `≤ ${value} 字`;
    case 'content.item_count_min':
      return `≥ ${value} 项`;
    case 'content.item_count_max':
      return `≤ ${value} 项`;
    case 'content.item_separator':
      return `分隔符「${value}」`;
    case 'page.size':
      return String(value);
    case 'page.margin_top_cm':
      return `上 ${value}cm`;
    case 'page.margin_bottom_cm':
      return `下 ${value}cm`;
    case 'page.margin_left_cm':
      return `左 ${value}cm`;
    case 'page.margin_right_cm':
      return `右 ${value}cm`;
    case 'page.new_page_before':
      return value === true ? '另起一页' : '';
    case 'pagination.front_style':
      return `前置页码：${PAGE_STYLE_LABEL[String(value)] ?? value}`;
    case 'pagination.body_style':
      return `正文页码：${PAGE_STYLE_LABEL[String(value)] ?? value}`;
    case 'mixed_script.ascii_is_tnr':
      return value === true ? '西文=Times New Roman' : '';
    case 'layout.position':
      return LAYOUT_POSITION_LABEL[String(value)] ?? String(value);
    case 'citation.style':
      return `引文样式：${value}`;
    default:
      // 未识别 key：保持原样展示，便于 debug + 不丢信息
      return `${key}=${String(value)}`;
  }
}

/**
 * 将字段 value 整体格式化为单行人读字符串
 *
 * 业务逻辑：
 * 1. 遍历 value 所有键，跳过 enabled 元字段
 * 2. 逐项调用 formatAttr，丢掉空字符串结果
 * 3. 用" · "连接所有片段
 *
 * @param value sidecar 返回的扁平属性 map，可能为 undefined
 * @returns     人读字符串；无任何有效属性时返回空串
 */
export function formatFieldValue(value: Record<string, unknown> | undefined): string {
  if (!value) return '';
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(value)) {
    // enabled 是模板结构外层字段，不在 value 内展示
    if (key === 'enabled') continue;
    const fragment = formatAttr(key, raw);
    if (fragment) parts.push(fragment);
  }
  return parts.join(' · ');
}
