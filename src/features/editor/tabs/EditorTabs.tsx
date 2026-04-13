/**
 * @file EditorTabs.tsx - 编辑器标签栏
 * @description 展示已打开文件的标签页列表，支持切换激活文件、关闭文件、脏标记显示
 *              active 标签使用底部蓝色线条高亮，dirty 文件名右侧显示小圆点
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { useEditorStore } from '../editorStore';

/** 从完整路径中提取文件名 */
function getFileName(path: string): string {
  return path.split('/').pop() ?? path;
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
        // 隐藏滚动条
        scrollbarWidth: 'none',
      }}
    >
      {openFiles.map((file) => {
        const isActive = file.path === activeFilePath;
        const fileName = getFileName(file.path);

        return (
          <div
            key={file.path}
            role="tab"
            aria-selected={isActive}
            data-active={isActive ? 'true' : 'false'}
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
              // active 标签底部蓝色线条
              borderBottom: isActive ? '2px solid #7aa2f7' : '2px solid transparent',
              borderTop: '2px solid transparent',
              transition: 'color 0.1s, border-bottom-color 0.1s',
              position: 'relative',
            }}
          >
            {/* 脏标记：使用 span 元素，不用 emoji */}
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

            {/* 文件名 */}
            <span>{fileName}</span>

            {/* 关闭按钮 */}
            <button
              aria-label={`关闭 ${fileName}`}
              onClick={(e) => {
                // 阻止冒泡，避免触发父级 setActive
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
              {/* 用 SVG 代替 X 字符，避免 emoji */}
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
        );
      })}
    </div>
  );
}
