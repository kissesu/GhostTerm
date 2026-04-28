/**
 * @file RuleValueEditor.tsx
 * @description 规则值编辑器。
 *   - RuleValueEditor（P3 遗留）：按 valueShape.kind 分发到对应子编辑器
 *   - RuleValueEditorByAttr（P4 新增）：按属性 key 分发，供 Task 17 RuleTemplateWorkspace 使用
 *   所有子编辑器内联在本文件（无第二调用点，不抽独立文件）。
 * @author Atlas.oi
 * @date 2026-04-18
 */

import type { ValueShape } from './ruleSchemas';

// 通用 input 样式，保持与项目其余表单元素一致
const inputStyle: React.CSSProperties = {
  padding: '3px 7px',
  background: 'var(--c-raised)',
  color: 'var(--c-fg)',
  border: '1px solid var(--c-border)',
  borderRadius: 'var(--r-sm)',
  fontSize: 12,
  fontFamily: 'var(--font-ui)',
  width: 100,
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  width: 'auto',
  cursor: 'pointer',
};

// ─────────────────────────────────────────────
// 子编辑器：font（正文字体）
// ─────────────────────────────────────────────

interface FontValue { family: string; size_pt: number }

function FontEditor({ value, onChange }: { value: FontValue; onChange: (v: FontValue) => void }) {
  return (
    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input
        data-testid="font-family"
        style={inputStyle}
        value={value?.family ?? ''}
        onChange={(e) => onChange({ ...value, family: e.target.value })}
        placeholder="字体名"
      />
      <input
        data-testid="font-size"
        style={{ ...inputStyle, width: 60 }}
        type="number"
        min={6}
        max={72}
        value={value?.size_pt ?? 12}
        onChange={(e) => onChange({ ...value, size_pt: Number(e.target.value) })}
        placeholder="pt"
      />
      <span style={{ fontSize: 11, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-ui)' }}>pt</span>
    </span>
  );
}

// ─────────────────────────────────────────────
// 子编辑器：fontBold（标题字体，含 bold 开关）
// ─────────────────────────────────────────────

interface FontBoldValue { family: string; size_pt: number; bold: boolean }

function FontBoldEditor({ value, onChange }: { value: FontBoldValue; onChange: (v: FontBoldValue) => void }) {
  return (
    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input
        data-testid="fontbold-family"
        style={inputStyle}
        value={value?.family ?? ''}
        onChange={(e) => onChange({ ...value, family: e.target.value })}
        placeholder="字体名"
      />
      <input
        data-testid="fontbold-size"
        style={{ ...inputStyle, width: 60 }}
        type="number"
        min={6}
        max={72}
        value={value?.size_pt ?? 14}
        onChange={(e) => onChange({ ...value, size_pt: Number(e.target.value) })}
      />
      <span style={{ fontSize: 11, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-ui)' }}>pt</span>
      {/* bold 开关：黑体需要 bold=true，宋体通常 false */}
      <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12, fontFamily: 'var(--font-ui)', color: 'var(--c-fg-muted)', cursor: 'pointer' }}>
        <input
          data-testid="fontbold-bold"
          type="checkbox"
          checked={value?.bold ?? false}
          onChange={(e) => onChange({ ...value, bold: e.target.checked })}
        />
        加粗
      </label>
    </span>
  );
}

// ─────────────────────────────────────────────
// 子编辑器：indent（段首缩进字符数）
// ─────────────────────────────────────────────

function IndentEditor({ value, onChange }: { value: { first_line_chars: number }; onChange: (v: { first_line_chars: number }) => void }) {
  return (
    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input
        data-testid="indent-chars"
        style={{ ...inputStyle, width: 60 }}
        type="number"
        min={0}
        max={10}
        value={value?.first_line_chars ?? 2}
        onChange={(e) => onChange({ first_line_chars: Number(e.target.value) })}
      />
      <span style={{ fontSize: 11, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-ui)' }}>字符</span>
    </span>
  );
}

// ─────────────────────────────────────────────
// 子编辑器：citation（引用格式，style + marker）
// ─────────────────────────────────────────────

const CITATION_STYLES = [
  { value: 'gbt7714', label: 'GB/T 7714' },
  { value: 'apa',     label: 'APA' },
  { value: 'mla',     label: 'MLA' },
];

const CITATION_MARKERS = [
  { value: 'superscript', label: '上标 [1]' },
  { value: 'bracket',     label: '方括号 [1]' },
  { value: 'author-year', label: '作者年份' },
];

interface CitationValue { style: string; marker: string }

function CitationEditor({ value, onChange }: { value: CitationValue; onChange: (v: CitationValue) => void }) {
  return (
    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <select
        data-testid="citation-style"
        style={selectStyle}
        value={value?.style ?? 'gbt7714'}
        onChange={(e) => onChange({ ...value, style: e.target.value })}
      >
        {CITATION_STYLES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <select
        data-testid="citation-marker"
        style={selectStyle}
        value={value?.marker ?? 'superscript'}
        onChange={(e) => onChange({ ...value, marker: e.target.value })}
      >
        {CITATION_MARKERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </span>
  );
}

// ─────────────────────────────────────────────
// 子编辑器：captionPos（之上 / 之下）
// ─────────────────────────────────────────────

function CaptionPosEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      data-testid="caption-pos"
      style={selectStyle}
      value={value ?? 'above'}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="above">之上</option>
      <option value="below">之下</option>
    </select>
  );
}

// ─────────────────────────────────────────────
// 子编辑器：Toggle（bool 和 allowed 共用）
// ─────────────────────────────────────────────

function Toggle({ checked, onChange, testId }: { checked: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <input
      data-testid={testId ?? 'toggle'}
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

// ─────────────────────────────────────────────
// 子编辑器：quoteStyle
// ─────────────────────────────────────────────

function QuoteStyleEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      data-testid="quote-style"
      style={selectStyle}
      value={value ?? 'cjk'}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="cjk">CJK 书名号「」</option>
      <option value="ascii">ASCII &quot;&quot;</option>
      <option value="mixed">混合</option>
    </select>
  );
}

// ─────────────────────────────────────────────
// 子编辑器：pagination（front_matter + body）
// ─────────────────────────────────────────────

const PAGINATION_STYLES = [
  { value: 'roman', label: 'I II III（罗马）' },
  { value: 'arabic', label: '1 2 3（阿拉伯）' },
  { value: 'none', label: '无页码' },
];

interface PaginationValue { front_matter: string; body: string }

function PaginationEditor({ value, onChange }: { value: PaginationValue; onChange: (v: PaginationValue) => void }) {
  return (
    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <span style={{ fontSize: 11, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-ui)' }}>前言</span>
      <select
        data-testid="pagination-front"
        style={selectStyle}
        value={value?.front_matter ?? 'roman'}
        onChange={(e) => onChange({ ...value, front_matter: e.target.value })}
      >
        {PAGINATION_STYLES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span style={{ fontSize: 11, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-ui)' }}>正文</span>
      <select
        data-testid="pagination-body"
        style={selectStyle}
        value={value?.body ?? 'arabic'}
        onChange={(e) => onChange({ ...value, body: e.target.value })}
      >
        {PAGINATION_STYLES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </span>
  );
}

// ─────────────────────────────────────────────
// 主组件：按 shape.kind 分发
// ─────────────────────────────────────────────

interface Props {
  shape: ValueShape;
  value: unknown;
  onChange: (next: unknown) => void;
}

export function RuleValueEditor({ shape, value, onChange }: Props) {
  switch (shape.kind) {
    case 'font':
      return <FontEditor value={value as FontValue} onChange={onChange} />;
    case 'fontBold':
      return <FontBoldEditor value={value as FontBoldValue} onChange={onChange} />;
    case 'indent':
      return <IndentEditor value={value as { first_line_chars: number }} onChange={onChange} />;
    case 'citation':
      return <CitationEditor value={value as CitationValue} onChange={onChange} />;
    case 'captionPos':
      return <CaptionPosEditor value={value as string} onChange={onChange} />;
    case 'allowed':
      return (
        <Toggle
          testId="allowed-toggle"
          checked={(value as { allowed: boolean })?.allowed ?? false}
          onChange={(b) => onChange({ allowed: b })}
        />
      );
    case 'bool':
      return (
        <Toggle
          testId="bool-toggle"
          checked={(value as boolean) ?? false}
          onChange={onChange}
        />
      );
    case 'quoteStyle':
      return <QuoteStyleEditor value={value as string} onChange={onChange} />;
    case 'aiPattern':
      // P3 范围只读，不支持前端编辑
      return (
        <span style={{ fontSize: 12, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-mono)' }}>
          {(value as { ruleset: string })?.ruleset ?? '—'}
        </span>
      );
    case 'pagination':
      return <PaginationEditor value={value as PaginationValue} onChange={onChange} />;
  }
}

// ═════════════════════════════════════════════════════════════════
// P4 新增：按属性 key 分发的子编辑器 + RuleValueEditorByAttr
// Task 17 RuleTemplateWorkspace 将使用此接口
// ═════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────
// P4 子编辑器：CJK 字体下拉（常见中文字体）
// ─────────────────────────────────────────────

// 常见 CJK 字体名称，来自 GB/T 7714 规范推荐字体
const CJK_FONT_OPTIONS = ['宋体', '黑体', '楷体', '仿宋', '楷体_GB2312', '仿宋_GB2312'];

function CjkFontSelect({ value, onChange }: { value: string; onChange: (v: unknown) => void }) {
  return (
    <select
      data-testid="attr-cjk-font"
      style={selectStyle}
      value={value ?? '宋体'}
      onChange={(e) => onChange(e.target.value)}
    >
      {CJK_FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
    </select>
  );
}

// ─────────────────────────────────────────────
// P4 子编辑器：ASCII 字体下拉（英文/数字字体）
// ─────────────────────────────────────────────

// 常见西文字体，Times New Roman 为论文默认推荐
const ASCII_FONT_OPTIONS = ['Times New Roman', 'Arial', 'Calibri', 'Cambria'];

function AsciiFontSelect({ value, onChange }: { value: string; onChange: (v: unknown) => void }) {
  return (
    <select
      data-testid="attr-ascii-font"
      style={selectStyle}
      value={value ?? 'Times New Roman'}
      onChange={(e) => onChange(e.target.value)}
    >
      {ASCII_FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
    </select>
  );
}

// ─────────────────────────────────────────────
// P4 子编辑器：字号数值输入（pt，支持半点）
// ─────────────────────────────────────────────

function SizeNameOrPtInput({ value, onChange }: { value: number; onChange: (v: unknown) => void }) {
  return (
    <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <input
        data-testid="attr-size-pt"
        style={{ ...inputStyle, width: 60 }}
        type="number"
        step={0.5}
        min={6}
        max={72}
        value={value ?? 12}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span style={{ fontSize: 11, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-ui)' }}>pt</span>
    </span>
  );
}

// ─────────────────────────────────────────────
// P4 子编辑器：对齐方式下拉
// ─────────────────────────────────────────────

function AlignSelect({ value, onChange }: { value: string; onChange: (v: unknown) => void }) {
  return (
    <select
      data-testid="attr-align"
      style={selectStyle}
      value={value ?? 'justify'}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="left">左对齐</option>
      <option value="center">居中</option>
      <option value="right">右对齐</option>
      <option value="justify">两端对齐</option>
    </select>
  );
}

// ─────────────────────────────────────────────
// P4 子编辑器：通用数值输入
// ─────────────────────────────────────────────

function NumberInput({ value, onChange, step = 1, min, testId, inputId }: {
  value: number;
  onChange: (v: unknown) => void;
  step?: number;
  min?: number;
  testId?: string;
  inputId?: string;
}) {
  return (
    <input
      id={inputId}
      data-testid={testId ?? 'attr-number'}
      style={{ ...inputStyle, width: 80 }}
      type="number"
      step={step}
      min={min}
      value={value ?? 0}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

// ─────────────────────────────────────────────
// P4 子编辑器：通用文本输入
// ─────────────────────────────────────────────

function TextInput({ value, onChange, testId, inputId }: {
  value: string;
  onChange: (v: unknown) => void;
  testId?: string;
  inputId?: string;
}) {
  return (
    <input
      id={inputId}
      data-testid={testId ?? 'attr-text'}
      style={inputStyle}
      type="text"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// ─────────────────────────────────────────────
// P4 子编辑器：枚举下拉（通用）
// ─────────────────────────────────────────────

function EnumSelect({ value, onChange, options, testId, inputId }: {
  value: string;
  onChange: (v: unknown) => void;
  options: { value: string; label: string }[];
  testId?: string;
  inputId?: string;
}) {
  return (
    <select
      id={inputId}
      data-testid={testId ?? 'attr-enum'}
      style={selectStyle}
      value={value ?? options[0]?.value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ─────────────────────────────────────────────
// Info 修复：EnumSelect options 提至模块级常量，避免每次 re-render 重建
// page.size / pagination / numbering 等枚举选项稳定，不依赖运行时状态
// ─────────────────────────────────────────────

const PAGE_SIZE_OPTIONS: { value: string; label: string }[] = [
  { value: 'A4', label: 'A4 (210×297mm)' },
  { value: 'B5', label: 'B5 (176×250mm)' },
  { value: 'Letter', label: 'Letter (216×279mm)' },
];

const PRINT_MODE_OPTIONS: { value: string; label: string }[] = [
  { value: 'single', label: '单面打印' },
  { value: 'double', label: '双面打印' },
];

const PAGINATION_FRONT_OPTIONS: { value: string; label: string }[] = [
  { value: 'roman', label: 'I II III（罗马）' },
  { value: 'arabic', label: '1 2 3（阿拉伯）' },
  { value: 'none', label: '无页码' },
];

const PAGINATION_BODY_OPTIONS: { value: string; label: string }[] = [
  { value: 'arabic', label: '1 2 3（阿拉伯）' },
  { value: 'roman', label: 'I II III（罗马）' },
  { value: 'none', label: '无页码' },
];

const CITATION_STYLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'gbt7714', label: 'GB/T 7714' },
  { value: 'apa', label: 'APA' },
  { value: 'mla', label: 'MLA' },
];

const LAYOUT_POSITION_OPTIONS: { value: string; label: string }[] = [
  { value: 'above', label: '之上' },
  { value: 'below', label: '之下' },
];

const FIGURE_STYLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'continuous', label: '连续编号（图1/图2）' },
  { value: 'chapter_based', label: '章节式（图1-1/图2-3）' },
];

const SUBFIGURE_STYLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'a_b_c', label: '(a)(b)(c)' },
  { value: '1_2_3', label: '.1/.2/.3' },
];

const FORMULA_STYLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'continuous', label: '连续编号（(1)/(2)）' },
  { value: 'chapter_based', label: '章节式（(1-1)/(2-3)）' },
];

// T2.3: 行距类型枚举（OOXML w:lineRule 6 类型）
// single/oneAndHalf/double 是固定倍数；atLeast/exactly 配合 line_spacing_pt；
// multiple 配合 line_spacing 倍数。规范文本中常见"1.5 倍行距"对应 oneAndHalf，
// "20 磅"对应 exactly+pt，"多倍 1.25"对应 multiple。
const LINE_SPACING_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'single', label: '单倍行距' },
  { value: 'oneAndHalf', label: '1.5 倍行距' },
  { value: 'double', label: '2 倍行距' },
  { value: 'atLeast', label: '最小值' },
  { value: 'exactly', label: '固定值' },
  { value: 'multiple', label: '多倍行距' },
];

// ─────────────────────────────────────────────
// P4 主组件：按属性 key 分发（22+ case）
// ─────────────────────────────────────────────

export interface RuleValueEditorByAttrProps {
  attr: string;
  value: unknown;
  onChange: (next: unknown) => void;
  /** W7 修复：透传给底层 input/select 的 id，供 label[for] 关联 */
  inputId?: string;
}

/**
 * 按属性 key 分发到对应子编辑器（P4 版本）
 *
 * 业务逻辑：
 * 1. attr 对应 fieldDefs.ts 中 applicable_attributes 的条目
 * 2. 每个 case 处理一种属性类型，向上报 onChange(newValue)
 * 3. W7 修复：inputId 透传给底层 input/select，供 FieldList 的 label[for] 关联
 * 4. default 用 JSON 预览兜底，不隐藏未知属性
 */
export function RuleValueEditorByAttr({ attr, value, onChange, inputId }: RuleValueEditorByAttrProps) {
  switch (attr) {
    // ── 字体属性 ──────────────────────────────
    case 'font.cjk':
      return <CjkFontSelect value={value as string} onChange={onChange} />;

    case 'font.ascii':
      return <AsciiFontSelect value={value as string} onChange={onChange} />;

    case 'font.size_pt':
      return <SizeNameOrPtInput value={value as number} onChange={onChange} />;

    case 'font.bold':
      return (
        <Toggle
          testId="attr-bold"
          checked={(value as boolean) ?? false}
          onChange={onChange}
        />
      );

    // ── 段落属性 ──────────────────────────────
    case 'para.align':
      return <AlignSelect value={value as string} onChange={onChange} />;

    case 'para.first_line_indent_chars':
      return (
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <NumberInput value={value as number} onChange={onChange} step={0.5} min={0} testId="attr-indent" inputId={inputId} />
          <span style={{ fontSize: 11, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-ui)' }}>字符</span>
        </span>
      );

    case 'para.hanging_indent_chars':
      return (
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <NumberInput value={value as number} onChange={onChange} step={0.5} min={0} testId="attr-hanging-indent" inputId={inputId} />
          <span style={{ fontSize: 11, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-ui)' }}>字符</span>
        </span>
      );

    case 'para.line_spacing':
      return (
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <NumberInput value={value as number} onChange={onChange} step={0.05} min={1} testId="attr-line-spacing" inputId={inputId} />
          <span style={{ fontSize: 11, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-ui)' }}>倍</span>
        </span>
      );

    // T2.3: 行距类型（OOXML w:lineRule，6 枚举值）
    case 'para.line_spacing_type':
      return (
        <EnumSelect
          value={value as string}
          onChange={onChange}
          options={LINE_SPACING_TYPE_OPTIONS}
          testId="attr-line-spacing-type"
          inputId={inputId}
        />
      );

    // T2.3: 行距磅值（atLeast/exactly 配合此字段；multiple/single 等忽略）
    case 'para.line_spacing_pt':
      return (
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <NumberInput value={value as number} onChange={onChange} step={0.5} min={0} testId="attr-line-spacing-pt" inputId={inputId} />
          <span style={{ fontSize: 11, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-ui)' }}>pt</span>
        </span>
      );

    // T2.3: 首行缩进磅值（与 _chars 共存；规范写"21 磅"时用此项）
    case 'para.first_line_indent_pt':
      return (
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <NumberInput value={value as number} onChange={onChange} step={0.5} min={0} testId="attr-first-line-indent-pt" inputId={inputId} />
          <span style={{ fontSize: 11, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-ui)' }}>pt</span>
        </span>
      );

    // T2.3: 悬挂缩进磅值（参考文献条目第二行起的悬挂量，规范常写"21 磅"）
    case 'para.hanging_indent_pt':
      return (
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <NumberInput value={value as number} onChange={onChange} step={0.5} min={0} testId="attr-hanging-indent-pt" inputId={inputId} />
          <span style={{ fontSize: 11, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-ui)' }}>pt</span>
        </span>
      );

    case 'para.letter_spacing_chars':
      return (
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <NumberInput value={value as number} onChange={onChange} step={0.5} min={0} testId="attr-letter-spacing" inputId={inputId} />
          <span style={{ fontSize: 11, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-ui)' }}>字符</span>
        </span>
      );

    // T2.3: 字符间距磅值（"摘 要"两字间距 2 磅等场景，与 _chars 共存）
    case 'para.letter_spacing_pt':
      return (
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <NumberInput value={value as number} onChange={onChange} step={0.1} min={0} testId="attr-letter-spacing-pt" inputId={inputId} />
          <span style={{ fontSize: 11, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-ui)' }}>pt</span>
        </span>
      );

    case 'para.space_before_lines':
      return (
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <NumberInput value={value as number} onChange={onChange} step={0.5} min={0} testId="attr-space-before" inputId={inputId} />
          <span style={{ fontSize: 11, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-ui)' }}>行</span>
        </span>
      );

    case 'para.space_after_lines':
      return (
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <NumberInput value={value as number} onChange={onChange} step={0.5} min={0} testId="attr-space-after" inputId={inputId} />
          <span style={{ fontSize: 11, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-ui)' }}>行</span>
        </span>
      );

    // T3.1: 段前/段后磅值（与 _lines 版本共存，规范写"磅"时用此两项）
    case 'para.space_before_pt':
      return (
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <NumberInput value={value as number} onChange={onChange} step={0.5} min={0} testId="attr-space-before-pt" inputId={inputId} />
          <span style={{ fontSize: 11, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-ui)' }}>pt</span>
        </span>
      );

    case 'para.space_after_pt':
      return (
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <NumberInput value={value as number} onChange={onChange} step={0.5} min={0} testId="attr-space-after-pt" inputId={inputId} />
          <span style={{ fontSize: 11, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-ui)' }}>pt</span>
        </span>
      );

    // ── 内容属性 ──────────────────────────────
    case 'content.specific_text':
      return <TextInput value={value as string} onChange={onChange} testId="attr-specific-text" inputId={inputId} />;

    case 'content.char_count_min':
      return <NumberInput value={value as number} onChange={onChange} step={1} min={0} testId="attr-char-min" inputId={inputId} />;

    case 'content.char_count_max':
      return <NumberInput value={value as number} onChange={onChange} step={1} min={0} testId="attr-char-max" inputId={inputId} />;

    case 'content.item_count_min':
      return <NumberInput value={value as number} onChange={onChange} step={1} min={0} testId="attr-item-min" inputId={inputId} />;

    case 'content.item_count_max':
      return <NumberInput value={value as number} onChange={onChange} step={1} min={0} testId="attr-item-max" inputId={inputId} />;

    case 'content.item_separator':
      return <TextInput value={value as string} onChange={onChange} testId="attr-item-sep" inputId={inputId} />;

    // ── 页面属性 ──────────────────────────────
    case 'page.size':
      return (
        <EnumSelect
          value={value as string}
          onChange={onChange}
          testId="attr-page-size"
          inputId={inputId}
          options={PAGE_SIZE_OPTIONS}
        />
      );

    case 'page.margin_top_cm':
      return (
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <NumberInput value={value as number} onChange={onChange} step={0.1} min={0} testId="attr-margin-top" inputId={inputId} />
          <span style={{ fontSize: 11, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-ui)' }}>cm</span>
        </span>
      );

    case 'page.margin_bottom_cm':
      return (
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <NumberInput value={value as number} onChange={onChange} step={0.1} min={0} testId="attr-margin-bottom" inputId={inputId} />
          <span style={{ fontSize: 11, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-ui)' }}>cm</span>
        </span>
      );

    case 'page.margin_left_cm':
      return (
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <NumberInput value={value as number} onChange={onChange} step={0.1} min={0} testId="attr-margin-left" inputId={inputId} />
          <span style={{ fontSize: 11, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-ui)' }}>cm</span>
        </span>
      );

    case 'page.margin_right_cm':
      return (
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <NumberInput value={value as number} onChange={onChange} step={0.1} min={0} testId="attr-margin-right" inputId={inputId} />
          <span style={{ fontSize: 11, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-ui)' }}>cm</span>
        </span>
      );

    // T3.1: 装订线宽度
    case 'page.margin_gutter_cm':
      return (
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <NumberInput value={value as number} onChange={onChange} step={0.1} min={0} testId="attr-margin-gutter" inputId={inputId} />
          <span style={{ fontSize: 11, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-ui)' }}>cm</span>
        </span>
      );

    // T3.1: 页眉距页面边界
    case 'page.header_offset_cm':
      return (
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <NumberInput value={value as number} onChange={onChange} step={0.1} min={0} testId="attr-header-offset" inputId={inputId} />
          <span style={{ fontSize: 11, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-ui)' }}>cm</span>
        </span>
      );

    // T3.1: 页脚距页面边界
    case 'page.footer_offset_cm':
      return (
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <NumberInput value={value as number} onChange={onChange} step={0.1} min={0} testId="attr-footer-offset" inputId={inputId} />
          <span style={{ fontSize: 11, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-ui)' }}>cm</span>
        </span>
      );

    // T3.1: 打印模式（单面/双面，严格枚举）
    case 'page.print_mode':
      return (
        <EnumSelect
          value={value as string}
          onChange={onChange}
          testId="attr-print-mode"
          inputId={inputId}
          options={PRINT_MODE_OPTIONS}
        />
      );

    case 'page.new_page_before':
      return (
        <Toggle
          testId="attr-new-page"
          checked={(value as boolean) ?? false}
          onChange={onChange}
        />
      );

    // ── 分页格式 ──────────────────────────────
    case 'pagination.front_style':
      return (
        <EnumSelect
          value={value as string}
          onChange={onChange}
          testId="attr-pagination-front"
          inputId={inputId}
          options={PAGINATION_FRONT_OPTIONS}
        />
      );

    case 'pagination.body_style':
      return (
        <EnumSelect
          value={value as string}
          onChange={onChange}
          testId="attr-pagination-body"
          inputId={inputId}
          options={PAGINATION_BODY_OPTIONS}
        />
      );

    // ── 引用格式 ──────────────────────────────
    case 'citation.style':
      return (
        <EnumSelect
          value={value as string}
          onChange={onChange}
          testId="attr-citation-style"
          inputId={inputId}
          options={CITATION_STYLE_OPTIONS}
        />
      );

    // ── 布局属性 ──────────────────────────────
    case 'layout.position':
      return (
        <EnumSelect
          value={value as string}
          onChange={onChange}
          testId="attr-layout-position"
          inputId={inputId}
          options={LAYOUT_POSITION_OPTIONS}
        />
      );

    // ── 编号风格属性（T3.3）──────────────────────
    // T3.3: 图编号风格（连续式 vs 章节式）
    case 'numbering.figure_style':
      return (
        <EnumSelect
          value={value as string}
          onChange={onChange}
          testId="attr-fig-numbering"
          inputId={inputId}
          options={FIGURE_STYLE_OPTIONS}
        />
      );

    // T3.3: 分图编号风格（字母 vs 数字点号）
    case 'numbering.subfigure_style':
      return (
        <EnumSelect
          value={value as string}
          onChange={onChange}
          testId="attr-subfig-numbering"
          inputId={inputId}
          options={SUBFIGURE_STYLE_OPTIONS}
        />
      );

    // T3.3: 公式编号风格（连续式 vs 章节式）
    case 'numbering.formula_style':
      return (
        <EnumSelect
          value={value as string}
          onChange={onChange}
          testId="attr-formula-numbering"
          inputId={inputId}
          options={FORMULA_STYLE_OPTIONS}
        />
      );

    // ── 表格结构属性（T3.2）──────────────────────
    // T3.2: 三线表开关（布尔，Toggle）
    case 'table.is_three_line':
      return (
        <Toggle
          testId="attr-three-line"
          checked={(value as boolean) ?? false}
          onChange={onChange}
        />
      );

    // T3.2: 表格上边框线宽（pt，数值输入）
    case 'table.border_top_pt':
      return (
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <NumberInput value={value as number} onChange={onChange} step={0.1} min={0} testId="attr-border-top" inputId={inputId} />
          <span style={{ fontSize: 11, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-ui)' }}>pt</span>
        </span>
      );

    // T3.2: 表格下边框线宽（pt，数值输入）
    case 'table.border_bottom_pt':
      return (
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <NumberInput value={value as number} onChange={onChange} step={0.1} min={0} testId="attr-border-bottom" inputId={inputId} />
          <span style={{ fontSize: 11, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-ui)' }}>pt</span>
        </span>
      );

    // T3.2: 表头下边框线宽（pt，数值输入）
    case 'table.header_border_pt':
      return (
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <NumberInput value={value as number} onChange={onChange} step={0.1} min={0} testId="attr-border-header" inputId={inputId} />
          <span style={{ fontSize: 11, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-ui)' }}>pt</span>
        </span>
      );

    // ── 混排属性 ──────────────────────────────
    case 'mixed_script.ascii_is_tnr':
      // 数字/西文是否强制 Times New Roman
      return (
        <Toggle
          testId="attr-ascii-tnr"
          checked={(value as boolean) ?? true}
          onChange={onChange}
        />
      );

    case 'mixed_script.punct_space_after':
      // 英文标点后是否规范空一字符（句号/逗号/分号等 ASCII 标点后接空格）
      return (
        <Toggle
          testId="attr-punct-space-after"
          checked={(value as boolean) ?? false}
          onChange={onChange}
        />
      );

    // ── 默认：JSON 预览（不隐藏未知属性）──────
    default:
      return (
        <span
          data-testid="attr-fallback"
          style={{ fontSize: 12, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-mono)' }}
        >
          {JSON.stringify(value)}
        </span>
      );
  }
}
