/**
 * @file EditorTabs.tsx - 编辑器标签栏
 * @description 展示已打开文件的标签页列表，支持切换激活文件、关闭文件、脏标记显示
 *              active 标签使用底部蓝色线条高亮，dirty 文件名右侧显示小圆点
 * @author Atlas.oi
 * @date 2026-04-13
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

/** 从完整路径中提取文件名 */
function getFileName(path: string): string {
  return path.split('/').pop() ?? path;
}

const menuItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 12px',
  cursor: 'pointer',
  fontSize: 13,
  color: '#c0caf5',
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

  const copyToClipboard = async (value: string) => {
    await navigator.clipboard.writeText(value);
  };

  const handleCopyPath = () => {
    void copyToClipboard(path);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        style={{
          background: '#1a1b26',
          border: '1px solid #27293d',
          borderRadius: 4,
          padding: '4px 0',
          minWidth: 160,
          zIndex: 200,
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
        <ContextMenuSeparator style={{ borderTop: '1px solid #27293d', margin: '2px 0' }} />
        <ContextMenuItem
          onClick={handleCopyPath}
          onSelect={handleCopyPath}
          style={menuItemStyle}
        >
          <Copy size={12} aria-hidden />
          发送路径
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export default function EditorTabs() {
  const { openFiles, activeFilePath, setActive, closeFile } = useEditorStore();

  if (openFiles.length === 0) {
    return null;
  }

  return (
    <div
      role="tablist"
      style={{
        display: 'flex',
        alignItems: 'stretch',
        height: '36px',
        backgroundColor: '#16161e',
        borderBottom: '1px solid #27293d',
        overflowX: 'auto',
        overflowY: 'hidden',
        flexShrink: 0,
        scrollbarWidth: 'none',
      }}
    >
      {openFiles.map((file, index) => {
        const isActive = file.path === activeFilePath;
        const fileName = getFileName(file.path);

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
                gap: '6px',
                padding: '0 12px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                fontSize: '13px',
                color: isActive ? '#c0caf5' : '#565f89',
                backgroundColor: isActive ? '#1a1b26' : 'transparent',
                borderBottom: isActive ? '2px solid #7aa2f7' : '2px solid transparent',
                borderTop: '2px solid transparent',
                transition: 'color 0.1s, border-bottom-color 0.1s',
                position: 'relative',
              }}
            >
              {file.isDirty && (
                <span
                  data-testid="dirty-indicator"
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: '#7aa2f7',
                    display: 'inline-block',
                    flexShrink: 0,
                  }}
                />
              )}

              <span>{fileName}</span>

              <button
                aria-label={`关闭 ${fileName}`}
                onClick={(e) => {
                  e.stopPropagation();
                  closeFile(file.path);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '16px',
                  height: '16px',
                  borderRadius: '3px',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: '#565f89',
                  fontSize: '12px',
                  padding: 0,
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M1 1L9 9M9 1L1 9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          </TabContextMenu>
        );
      })}
    </div>
  );
}
