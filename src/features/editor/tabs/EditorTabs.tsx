/**
 * @file EditorTabs.tsx - 编辑器标签栏
 * @description 展示已打开文件的标签页列表，支持切换激活文件、关闭文件、脏标记显示。
 *              重设计：更精致的 active 高亮，脏标记改为圆点在文件名后，hover 才显示关闭按钮。
 * @author Atlas.oi
 * @date 2026-04-15
 */

import type { CSSProperties, ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@radix-ui/react-context-menu';
import { Copy, X } from 'lucide-react';
import { useEditorStore } from '../editorStore';

function getFileName(path: string): string {
  return path.split('/').pop() ?? path;
}

const menuItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '5px 12px',
  cursor: 'pointer',
  fontSize: 12,
  color: 'var(--c-fg)',
  borderRadius: 4,
  fontFamily: 'var(--font-ui)',
};

function TabContextMenu({
  path,
  index,
  total,
  children,
}: {
  path: string;
  index: number;
  total: number;
  children: ReactNode;
}) {
  const { closeFile, closeAll, closeOthers, closeLeft, closeRight } = useEditorStore();

  const handleCopyPath = () => {
    void navigator.clipboard.writeText(path);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        style={{
          background: 'var(--c-overlay)',
          border: '1px solid var(--c-border)',
          borderRadius: 'var(--r-md)',
          padding: '4px',
          minWidth: 168,
          zIndex: 200,
          boxShadow: 'var(--shadow-menu)',
        }}
      >
        <ContextMenuItem onSelect={() => closeFile(path)} style={menuItemStyle}>
          <X size={12} aria-hidden />
          关闭标签
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => closeOthers(path)} style={menuItemStyle}>
          <X size={12} aria-hidden />
          关闭其他
        </ContextMenuItem>
        {index > 0 && (
          <ContextMenuItem onSelect={() => closeLeft(path)} style={menuItemStyle}>
            <X size={12} aria-hidden />
            关闭左侧所有
          </ContextMenuItem>
        )}
        {index < total - 1 && (
          <ContextMenuItem onSelect={() => closeRight(path)} style={menuItemStyle}>
            <X size={12} aria-hidden />
            关闭右侧所有
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={closeAll} style={menuItemStyle}>
          <X size={12} aria-hidden />
          关闭所有
        </ContextMenuItem>
        <ContextMenuSeparator
          style={{ borderTop: '1px solid var(--c-border)', margin: '4px 0' }}
        />
        <ContextMenuItem onClick={handleCopyPath} onSelect={handleCopyPath} style={menuItemStyle}>
          <Copy size={12} aria-hidden />
          复制路径
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export default function EditorTabs() {
  const { openFiles, activeFilePath, setActive, closeFile } = useEditorStore();

  if (openFiles.length === 0) return null;

  return (
    <div
      role="tablist"
      style={{
        display: 'flex',
        alignItems: 'stretch',
        height: 36,
        backgroundColor: 'var(--c-bg)',
        borderBottom: '1px solid var(--c-border-sub)',
        overflowX: 'auto',
        overflowY: 'hidden',
        flexShrink: 0,
        scrollbarWidth: 'none',
      }}
    >
      {openFiles.map((file, index) => {
        const isActive  = file.path === activeFilePath;
        const fileName  = getFileName(file.path);

        return (
          <TabContextMenu key={file.path} path={file.path} index={index} total={openFiles.length}>
            <div
              role="tab"
              aria-selected={isActive}
              data-active={isActive ? 'true' : 'false'}
              data-testid={`editor-tab-${file.path}`}
              onClick={() => setActive(file.path)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '0 10px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                fontSize: 12,
                fontWeight: isActive ? 500 : 400,
                color: isActive ? 'var(--c-fg)' : 'var(--c-fg-muted)',
                backgroundColor: isActive ? 'var(--c-bg)' : 'transparent',
                borderBottom: isActive
                  ? '2px solid var(--c-accent)'
                  : '2px solid transparent',
                borderTop: '2px solid transparent',
                transition: 'color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out)',
                position: 'relative',
              }}
            >
              <span>{fileName}</span>

              {/* 脏标记：未保存时显示 accent 圆点 */}
              {file.isDirty && (
                <span
                  data-testid="dirty-indicator"
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    backgroundColor: 'var(--c-accent)',
                    display: 'inline-block',
                    flexShrink: 0,
                  }}
                />
              )}

              {/* 关闭按钮 */}
              <button
                aria-label={`关闭 ${fileName}`}
                onClick={(e) => { e.stopPropagation(); closeFile(file.path); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: 'var(--c-fg-subtle)',
                  padding: 0,
                  flexShrink: 0,
                  transition: 'color var(--dur-fast) var(--ease-out)',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-fg)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-fg-subtle)'; }}
              >
                <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                  <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </TabContextMenu>
        );
      })}
    </div>
  );
}
