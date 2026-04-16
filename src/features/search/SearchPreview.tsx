/**
 * @file SearchPreview.tsx - 搜索结果预览面板
 * @description 显示当前选中匹配结果的上下文行，简化版（仅展示相邻匹配行）
 * @author Atlas.oi
 * @date 2026-04-16
 */

import { useSearchStore } from './searchStore';

export default function SearchPreview() {
  const results = useSearchStore((s) => s.results);
  const selectedFileIdx = useSearchStore((s) => s.selectedFileIdx);
  const selectedMatchIdx = useSearchStore((s) => s.selectedMatchIdx);

  // 无结果时显示占位文字
  if (results.length === 0) {
    return (
      <div
        style={{
          height: 120,
          overflow: 'hidden',
          padding: '8px 12px',
          borderTop: '1px solid var(--c-border)',
        }}
      >
        <div
          style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--c-fg-muted)',
            fontSize: 13,
          }}
        >
          选择结果以预览
        </div>
      </div>
    );
  }

  const currentFile = results[selectedFileIdx];
  if (!currentFile) {
    return (
      <div
        style={{
          height: 120,
          overflow: 'hidden',
          padding: '8px 12px',
          borderTop: '1px solid var(--c-border)',
        }}
      >
        <div
          style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--c-fg-muted)',
            fontSize: 13,
          }}
        >
          选择结果以预览
        </div>
      </div>
    );
  }

  // 计算展示范围：激活匹配行前后各 ±2 条（在当前文件的 matches 列表中）
  const CONTEXT_RANGE = 2;
  const start = Math.max(0, selectedMatchIdx - CONTEXT_RANGE);
  const end = Math.min(currentFile.matches.length - 1, selectedMatchIdx + CONTEXT_RANGE);
  const visibleMatches = currentFile.matches.slice(start, end + 1);

  return (
    <div
      style={{
        height: 120,
        overflow: 'hidden',
        padding: '8px 12px',
        borderTop: '1px solid var(--c-border)',
      }}
    >
      {/* 文件名标题 */}
      <div
        style={{
          fontSize: 12,
          color: 'var(--c-fg-subtle)',
          marginBottom: 4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {currentFile.filePath}
      </div>

      {/* 上下文匹配行：激活行高亮背景 */}
      <div style={{ overflow: 'hidden' }}>
        {visibleMatches.map((match, i) => {
          const absoluteIdx = start + i;
          const isActive = absoluteIdx === selectedMatchIdx;
          return (
            <div
              key={`${match.lineNumber}-${i}`}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 8,
                padding: '1px 4px',
                borderRadius: 3,
                background: isActive ? 'var(--c-accent-muted)' : 'transparent',
                fontSize: 12,
                fontFamily: 'monospace',
                color: isActive ? 'var(--c-fg)' : 'var(--c-fg-muted)',
                overflow: 'hidden',
              }}
            >
              {/* 行号 */}
              <span
                style={{
                  minWidth: 36,
                  textAlign: 'right',
                  flexShrink: 0,
                  userSelect: 'none',
                  color: 'var(--c-fg-subtle)',
                }}
              >
                {match.lineNumber}
              </span>
              {/* 行内容（预览区不高亮，简单展示） */}
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                }}
              >
                {match.lineContent}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
