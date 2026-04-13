/**
 * @file ProjectSelector.tsx
 * @description 项目选择器组件 - 显示当前项目名称和路径，点击展开最近项目下拉列表。
 *              顶部紧凑布局，适合侧边栏窄宽度展示。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { ChevronDown, FolderOpen, Folder } from 'lucide-react';
import { useProjectStore } from './projectStore';

/**
 * 将完整路径缩略为可读短路径
 * 例：/Users/atlas/CodeCoding/ghostterm → ~/CodeCoding/ghostterm
 */
function shortenPath(fullPath: string): string {
  const home = '/Users/';
  if (fullPath.startsWith(home)) {
    return '~/' + fullPath.slice(home.indexOf('/') + 1 + fullPath.slice(home.length).split('/')[0].length + 1);
  }
  return fullPath;
}

/** 项目选择器组件 */
export default function ProjectSelector() {
  const { currentProject, recentProjects, switchProject } = useProjectStore();
  // 控制下拉列表显隐
  const [open, setOpen] = useState(false);

  const handleSelect = async (path: string) => {
    setOpen(false);
    try {
      await switchProject(path);
    } catch (err) {
      // 捕获防止 unhandled promise rejection
      // currentProject 保持为已切换的项目（与后端一致），不清空
      console.error('[ProjectSelector] 切换项目失败:', err);
    }
  };

  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      {/* 当前项目展示按钮 */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="选择项目"
        aria-expanded={open}
        aria-haspopup="listbox"
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 10px',
          background: 'transparent',
          border: 'none',
          borderBottom: '1px solid #27293d',
          cursor: 'pointer',
          color: '#c0caf5',
          textAlign: 'left',
        }}
      >
        {/* 文件夹图标 */}
        {currentProject ? (
          <FolderOpen size={14} color="#7aa2f7" aria-hidden />
        ) : (
          <Folder size={14} color="#565f89" aria-hidden />
        )}

        {/* 项目名和路径 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {currentProject ? (
            <>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: 13,
                  color: '#c0caf5',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                data-testid="current-project-name"
              >
                {currentProject.name}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: '#565f89',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                data-testid="current-project-path"
              >
                {shortenPath(currentProject.path)}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: '#565f89' }}>未打开项目</div>
          )}
        </div>

        <ChevronDown
          size={12}
          color="#565f89"
          style={{
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s',
            flexShrink: 0,
          }}
          aria-hidden
        />
      </button>

      {/* 下拉列表 */}
      {open && (
        <div
          role="listbox"
          aria-label="最近项目列表"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 100,
            background: '#1a1b26',
            border: '1px solid #27293d',
            borderTop: 'none',
            maxHeight: 260,
            overflowY: 'auto',
          }}
        >
          {/* 最近项目列表 */}
          {recentProjects.length > 0 ? (
            recentProjects.map((project) => (
              <button
                key={project.path}
                role="option"
                aria-selected={currentProject?.path === project.path}
                onClick={() => handleSelect(project.path)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px',
                  background:
                    currentProject?.path === project.path ? '#1f2335' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#c0caf5',
                  textAlign: 'left',
                }}
              >
                <Folder size={12} color="#565f89" aria-hidden />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {project.name}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: '#565f89',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {shortenPath(project.path)}
                  </div>
                </div>
              </button>
            ))
          ) : (
            <div
              style={{ padding: '8px 10px', fontSize: 12, color: '#565f89' }}
            >
              暂无最近项目
            </div>
          )}

          {/* 分割线 + 打开文件夹选项 */}
          <div style={{ borderTop: '1px solid #27293d', margin: '2px 0' }} />
          <button
            onClick={async () => {
              setOpen(false);
              // 调用 Tauri 原生文件夹选择对话框
              const selected = await openDialog({ directory: true, multiple: false });
              if (selected) {
                try {
                  await switchProject(selected as string);
                } catch (err) {
                  console.error('[ProjectSelector] 打开项目失败:', err);
                }
              }
            }}
            style={{
              width: '100%',
              padding: '6px 10px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#7aa2f7',
              fontSize: 12,
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
            data-testid="open-folder-btn"
          >
            <FolderOpen size={12} aria-hidden />
            打开文件夹...
          </button>
        </div>
      )}
    </div>
  );
}
