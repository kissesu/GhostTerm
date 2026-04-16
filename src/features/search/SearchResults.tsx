/**
 * @file SearchResults.tsx - 搜索结果列表
 * @description 按文件分组展示搜索结果，支持关键词高亮、行号显示和结果选中交互
 * @author Atlas.oi
 * @date 2026-04-16
 */

import React from 'react';
import { FileCode } from 'lucide-react';
import { useSearchStore } from './searchStore';

/**
 * 将匹配行内容按列偏移分割成三段，中间段用 mark 标签高亮
 *
 * 注意：colStart/colEnd 是字节偏移，对纯 ASCII 等于字符偏移；
 * 对中文等多字节字符可能不精确，但作为 MVP 可接受
 */
function highlightMatch(content: string, colStart: number, colEnd: number): React.ReactNode {
  const before = content.slice(0, colStart);
  const matched = content.slice(colStart, colEnd);
  const after = content.slice(colEnd);
  return (
    <>
      {before}
      <mark
        style={{
          background: 'var(--c-accent-muted)',
          color: 'var(--c-fg)',
          borderRadius: 2,
        }}
      >
        {matched}
      </mark>
      {after}
    </>
  );
}

export default function SearchResults() {
  const results = useSearchStore((s) => s.results);
  const selectedFileIdx = useSearchStore((s) => s.selectedFileIdx);
  const selectedMatchIdx = useSearchStore((s) => s.selectedMatchIdx);
  const isSearching = useSearchStore((s) => s.isSearching);
  const query = useSearchStore((s) => s.query);

  // 搜索进行中：显示 loading 提示
  if (isSearching) {
    return (
      <div
        style={{
          flex: 1,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          maxHeight: 300,
          color: 'var(--c-fg-muted)',
          fontSize: 13,
        }}
      >
        搜索中...
      </div>
    );
  }

  // 有查询词但无结果：显示空态提示
  if (query.trim() && results.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          maxHeight: 300,
          color: 'var(--c-fg-muted)',
          fontSize: 13,
        }}
      >
        未找到匹配结果
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        maxHeight: 300,
      }}
    >
      {results.map((fileResult, fIdx) => (
        <div key={fileResult.absPath}>
          {/* 文件组头：文件图标 + 相对路径 + 匹配数 badge */}
          <div
            style={{
              padding: '6px 12px',
              fontSize: 12,
              color: 'var(--c-fg-subtle)',
              background: 'var(--c-surface-1)',
              position: 'sticky',
              top: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              zIndex: 1,
            }}
          >
            <FileCode size={12} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {fileResult.filePath}
            </span>
            {/* 匹配数 badge */}
            <span
              style={{
                padding: '1px 6px',
                borderRadius: 10,
                background: 'var(--c-surface-3)',
                fontSize: 11,
                flexShrink: 0,
              }}
            >
              {fileResult.matches.length}
              {fileResult.truncated ? '+' : ''}
            </span>
          </div>

          {/* 匹配行列表 */}
          {fileResult.matches.map((match, mIdx) => {
            const isActive = fIdx === selectedFileIdx && mIdx === selectedMatchIdx;
            return (
              <div
                key={`${match.lineNumber}-${mIdx}`}
                onClick={() => {
                  // 直接设置选中位置，然后确认打开文件
                  useSearchStore.setState({ selectedFileIdx: fIdx, selectedMatchIdx: mIdx });
                  useSearchStore.getState().confirmSelection();
                }}
                style={{
                  display: 'flex',
                  padding: '3px 12px',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontFamily: 'monospace',
                  background: isActive ? 'var(--c-surface-3)' : 'transparent',
                  alignItems: 'baseline',
                  gap: 8,
                }}
              >
                {/* 行号：右对齐，固定最小宽度 */}
                <span
                  style={{
                    color: 'var(--c-fg-subtle)',
                    minWidth: 40,
                    textAlign: 'right',
                    flexShrink: 0,
                    userSelect: 'none',
                  }}
                >
                  {match.lineNumber}
                </span>
                {/* 行内容：关键词高亮 */}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {highlightMatch(match.lineContent, match.columnStart, match.columnEnd)}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
