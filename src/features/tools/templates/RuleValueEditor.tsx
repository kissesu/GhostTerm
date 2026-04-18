/**
 * @file RuleValueEditor.tsx
 * @description 规则值编辑器。按 valueShape.kind 分发到对应子编辑器。
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
