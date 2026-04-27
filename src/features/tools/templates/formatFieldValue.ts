/**
 * @file formatFieldValue.ts
 * @description 将 sidecar 返回的字段 value（扁平 attrKey → primitive 的 map）
 *   翻译成人读中文字符串，用于 FieldList 展示"抓取到了什么规则约束"。
 *   例如 { "font.cjk": "宋体", "font.size_pt": 14, "font.bold": true } → "中 宋体 · 四号 · 加粗"
 * @author Atlas.oi
 * @date 2026-04-18
 */

import { ptToName } from './chineseSizeMap';

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
      // cjk/ascii 由 formatFieldValue 的后处理合并逻辑统一处理，此处返回空串跳过
      return '';
    case 'font.size_pt': {
      // 优先使用中文字号名（如"小四"），非标准尺寸退回 pt 数值
      const name = ptToName(Number(value));
      return name !== null ? name : `${value}pt`;
    }
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
    // T3.1: 段前/段后磅值版本（规范文本用"磅"描述时显示此格式）
    case 'para.space_before_pt':
      return `段前 ${value}pt`;
    case 'para.space_after_pt':
      return `段后 ${value}pt`;
    case 'content.specific_text':
      return `文本「${value}」`;
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
    // T3.1: 装订线/页眉脚距/打印模式
    case 'page.margin_gutter_cm':
      return `装订线 ${value}cm`;
    case 'page.header_offset_cm':
      return `页眉距边界 ${value}cm`;
    case 'page.footer_offset_cm':
      return `页脚距边界 ${value}cm`;
    case 'page.print_mode':
      return String(value) === 'double' ? '双面打印' : '单面打印';
    case 'page.new_page_before':
      return value === true ? '另起一页' : '';
    case 'pagination.front_style':
      return `前置页码：${PAGE_STYLE_LABEL[String(value)] ?? value}`;
    case 'pagination.body_style':
      return `正文页码：${PAGE_STYLE_LABEL[String(value)] ?? value}`;
    case 'mixed_script.ascii_is_tnr':
      return value === true ? '西文=Times New Roman' : '';
    case 'mixed_script.punct_space_after':
      // 检测结果为 true 表示英文标点后空格规范符合要求
      return value === true ? '英文标点后空一字符' : '';
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
 * 1. 预先收集 font.cjk / font.ascii，跳过 enabled 元字段
 * 2. 对其他属性逐项调用 formatAttr，丢掉空字符串结果
 * 3. 对 cjk/ascii 做合并后处理，生成"中西文 X"/"中 X · 西 Y"/"中 X"/"西 X"四种形式
 * 4. 合并片段置于最前，其余按迭代顺序跟随，用" · "连接
 *
 * @param value sidecar 返回的扁平属性 map，可能为 undefined
 * @returns     人读字符串；无任何有效属性时返回空串
 */
export function formatFieldValue(value: Record<string, unknown> | undefined): string {
  if (!value) return '';

  // cjk/ascii 单独收集，由后处理决定显示形式（避免同值出现"宋体 · 宋体"重复）
  let cjkVal: string | null = null;
  let asciiVal: string | null = null;
  const otherParts: string[] = [];

  for (const [key, raw] of Object.entries(value)) {
    // enabled 是模板结构外层字段，不在 value 内展示
    if (key === 'enabled') continue;

    if (key === 'font.cjk' && raw !== undefined && raw !== null && raw !== '') {
      cjkVal = String(raw);
      continue;
    }
    if (key === 'font.ascii' && raw !== undefined && raw !== null && raw !== '') {
      asciiVal = String(raw);
      continue;
    }

    const fragment = formatAttr(key, raw);
    if (fragment) otherParts.push(fragment);
  }

  // ── cjk/ascii 合并后处理 ──────────────────────────────────
  // 两者都存在且相同：模板对中西文用同一字体，合并为"中西文 X"减少视觉冗余
  // 两者都存在但不同：分别标注中/西，便于区分
  // 只有一种：加前缀说明字体作用范围
  const fontParts: string[] = [];
  if (cjkVal !== null && asciiVal !== null) {
    if (cjkVal === asciiVal) {
      fontParts.push(`中西文 ${cjkVal}`);
    } else {
      fontParts.push(`中 ${cjkVal} · 西 ${asciiVal}`);
    }
  } else if (cjkVal !== null) {
    fontParts.push(`中 ${cjkVal}`);
  } else if (asciiVal !== null) {
    fontParts.push(`西 ${asciiVal}`);
  }

  return [...fontParts, ...otherParts].join(' · ');
}
