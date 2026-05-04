/**
 * @file EditorStatusbar.tsx
 * @description 编辑器底部状态栏：显示光标位置 / 选区 / 总行 / EOL / 缩进 / 软换行 toggle / 跳转行号。
 *              数据由 Editor 主组件通过 props 注入，自身无状态（除 click 处理）。
 *              UI 风格对齐 CSS token (--c-bg-2/--c-fg-muted/--c-border-sub) 跟随主题。
 * @author Atlas.oi
 * @date 2026-05-04
 */

import type { CSSProperties } from 'react';

export interface StatusbarProps {
  cursorLine: number;
  cursorCol: number;
  selChars: number;
  selLines: number;
  totalLines: number;
  eol: 'LF' | 'CRLF';
  indent: { type: 'spaces' | 'tabs'; size: number };
  lineWrap: boolean;
  onToggleWrap: () => void;
  onGotoLine: () => void;
  filePath?: string;
}

const itemStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0 8px',
  height: '100%',
  fontSize: 11,
  color: 'var(--c-fg-muted)',
  fontFamily: 'JetBrains Mono, Menlo, monospace',
  whiteSpace: 'nowrap',
};

const buttonStyle: CSSProperties = {
  ...itemStyle,
  cursor: 'pointer',
  background: 'transparent',
  border: 'none',
};

export default function EditorStatusbar({
  cursorLine,
  cursorCol,
  selChars,
  selLines,
  totalLines,
  eol,
  indent,
  lineWrap,
  onToggleWrap,
  onGotoLine,
}: StatusbarProps) {
  return (
    <div
      data-testid="editor-statusbar"
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 22,
        background: 'var(--c-bg-2, transparent)',
        borderTop: '1px solid var(--c-border-sub, transparent)',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {/* 左侧：光标 + 选区 + 总行 */}
      <button type="button" style={buttonStyle} tabIndex={-1} onClick={onGotoLine} title="点击跳转到行（Cmd+G）">
        行 {cursorLine}, 列 {cursorCol}
      </button>
      {selChars > 0 && (
        <span style={itemStyle}>
          已选 {selChars} 字符{selLines > 1 ? ` · ${selLines} 行` : ''}
        </span>
      )}
      <span style={itemStyle}>共 {totalLines} 行</span>

      <span style={{ flex: 1 }} />

      {/* 右侧：EOL / 缩进 / 软换行 */}
      <span style={itemStyle}>{eol}</span>
      <span style={itemStyle}>
        {indent.type === 'spaces' ? `空格 ${indent.size}` : `Tab ${indent.size}`}
      </span>
      <button
        type="button"
        tabIndex={-1}
        style={{ ...buttonStyle, color: lineWrap ? 'var(--c-accent)' : 'var(--c-fg-muted)' }}
        onClick={onToggleWrap}
        title="切换软换行"
      >
        {lineWrap ? '软换行 开' : '软换行 关'}
      </button>
    </div>
  );
}
