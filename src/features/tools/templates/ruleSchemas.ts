/**
 * @file ruleSchemas.ts
 * @description 前端维护的规则元信息表。
 *   与 src-python 侧规则定义对齐，供 TemplateEditor 和 TemplateExtractor 共用。
 *   valueShape 决定 RuleValueEditor 分发到哪个子编辑器。
 * @author Atlas.oi
 * @date 2026-04-18
 */

// ─────────────────────────────────────────────
// value 形状类型枚举（决定渲染哪种子编辑器）
// ─────────────────────────────────────────────

export type ValueShape =
  | { kind: 'font' }       // {family: string, size_pt: number}
  | { kind: 'fontBold' }   // {family: string, size_pt: number, bold: boolean}（h1 专用）
  | { kind: 'indent' }     // {first_line_chars: number}
  | { kind: 'citation' }   // {style: string, marker: string}
  | { kind: 'captionPos' } // 'above' | 'below'
  | { kind: 'allowed' }    // {allowed: boolean}
  | { kind: 'bool' }       // boolean
  | { kind: 'quoteStyle' } // 'cjk' | 'ascii' | 'mixed'
  | { kind: 'aiPattern' }  // {ruleset: string}（P3 范围只读）
  | { kind: 'pagination' }; // {front_matter: string, body: string}

export interface RuleSchema {
  /** 中文标签，显示在 TemplateEditor 表格左侧 */
  label: string;
  /** 决定 RuleValueEditor 分发到哪个具体子组件 */
  valueShape: ValueShape;
}

// ─────────────────────────────────────────────
// 11 条规则的 schema 映射（按 spec Section 4 + 5 顺序）
// ─────────────────────────────────────────────

export const RULE_SCHEMAS: Record<string, RuleSchema> = {
  'font.body':          { label: '正文字体',     valueShape: { kind: 'font' } },
  'font.h1':            { label: '一级标题字体', valueShape: { kind: 'fontBold' } },
  'paragraph.indent':   { label: '段首缩进',     valueShape: { kind: 'indent' } },
  'citation.format':    { label: '引用格式',     valueShape: { kind: 'citation' } },
  'figure.caption_pos': { label: '图题位置',     valueShape: { kind: 'captionPos' } },
  'table.caption_pos':  { label: '表题位置',     valueShape: { kind: 'captionPos' } },
  'cjk_ascii_space':    { label: '中英文空格',   valueShape: { kind: 'allowed' } },
  'chapter.new_page':   { label: '章节分页',     valueShape: { kind: 'bool' } },
  'quote.style':        { label: '引号风格',     valueShape: { kind: 'quoteStyle' } },
  'ai_pattern.check':   { label: 'AI 化检测',    valueShape: { kind: 'aiPattern' } },
  'pagination':         { label: '页眉页脚分页', valueShape: { kind: 'pagination' } },
};
