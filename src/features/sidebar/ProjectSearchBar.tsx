/**
 * @file ProjectSearchBar.tsx - 项目搜索栏
 * @description 侧边栏内嵌搜索框，过滤项目列表。
 *              重设计：更清晰的焦点状态，图标颜色过渡。
 * @author Atlas.oi
 * @date 2026-04-15
 */

import { Search } from 'lucide-react';

interface ProjectSearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export default function ProjectSearchBar({ value, onChange }: ProjectSearchBarProps) {
  return (
    <div style={{ padding: '8px 10px' }}>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 32,
          borderRadius: 'var(--r-md)',
          border: '1px solid var(--c-border-sub)',
          background: 'var(--c-input)',
          padding: '0 10px',
          transition: 'border-color var(--dur-fast) var(--ease-out)',
          cursor: 'text',
        }}
        onFocusCapture={(e) => {
          (e.currentTarget as HTMLLabelElement).style.borderColor = 'var(--c-accent)';
        }}
        onBlurCapture={(e) => {
          (e.currentTarget as HTMLLabelElement).style.borderColor = 'var(--c-border-sub)';
        }}
      >
        <Search size={13} style={{ color: 'var(--c-fg-subtle)', flexShrink: 0 }} />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="搜索项目…"
          style={{
            flex: 1,
            minWidth: 0,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: 'var(--c-fg)',
            fontSize: 12,
            lineHeight: 1,
          }}
          data-testid="project-search-input"
        />
      </label>
    </div>
  );
}
