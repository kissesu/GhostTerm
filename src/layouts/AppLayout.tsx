/**
 * @file AppLayout - 应用主布局
 * @description GhostTerm 应用外壳：标题栏 + ProjectWorkspace。
 *              负责启动恢复逻辑、窗口宽度自动折叠侧边栏、键盘快捷键注册。
 * @author Atlas.oi
 * @date 2026-04-17
 */

import { useEffect, useRef, useState, useCallback, lazy, Suspense } from 'react';
import { useSidebarStore, useProjectStore } from '../features/sidebar';
import { useKeyboardShortcuts } from '../shared/hooks/useKeyboardShortcuts';
import WindowTitleBar from '../shared/components/WindowTitleBar';
import { useSettingsStore } from '../shared/stores/settingsStore';
import { ProjectWorkspace } from './ProjectWorkspace';

// 进度模块按需懒加载：首次切换到「进度」Tab 时才下载 chunk，
// 之后保持挂载（display:none），保留模块内部状态
const ProgressShell = lazy(() => import('../features/progress/ProgressShell'));

// 侧边栏自动折叠阈值（px）：窗口宽度小于此值时自动隐藏侧边栏
const SIDEBAR_AUTO_COLLAPSE_WIDTH = 800;

/**
 * GhostTerm 应用外壳
 *
 * 职责：
 * 1. 启动时恢复上次打开的项目
 * 2. 窗口宽度 < 800px 自动折叠侧边栏
 * 3. 注册全局键盘快捷键
 * 4. 渲染标题栏 + ProjectWorkspace
 */
export default function AppLayout() {
  const sidebarVisible = useSidebarStore((s) => s.visible);
  const openSettings = useSettingsStore((s) => s.openSettings);

  const [activePanel, setActivePanel] = useState<'editor' | 'terminal'>('editor');
  const userCollapsedRef = useRef(false);

  // ============================================
  // 顶层工作区切换：work（终端+编辑器） / progress（进度模块）
  // 切换通过 display:none 而非卸载，保留 xterm scrollback / Editor 状态
  // 进度模块按需首次挂载（progressMounted=true 后保持）
  // ============================================
  const [activeWorkspace, setActiveWorkspace] = useState<'work' | 'progress'>('work');
  const [progressMounted, setProgressMounted] = useState(false);
  if (activeWorkspace === 'progress' && !progressMounted) {
    // 在渲染过程中调用 setState 是合法模式（React 会重渲染当前组件而非 schedule）
    setProgressMounted(true);
  }

  const handleFocusToggle = useCallback((panel: 'editor' | 'terminal') => {
    setActivePanel((prev) => (prev === panel ? 'editor' : panel));
  }, []);

  const handleSidebarToggle = useCallback(() => {
    const { visible, toggleVisibility } = useSidebarStore.getState();
    userCollapsedRef.current = visible;
    toggleVisibility();
  }, []);

  useKeyboardShortcuts(handleFocusToggle, handleSidebarToggle);

  // ============================================
  // 启动时恢复上次打开的项目
  // ============================================
  useEffect(() => {
    const restore = async () => {
      const { loadRecentProjects, openProject } = useProjectStore.getState();
      await loadRecentProjects();
      const { recentProjects } = useProjectStore.getState();

      const { useEditorStore } = await import('../features/editor/editorStore');
      await Promise.all(
        recentProjects.map((p) =>
          useEditorStore.getState().loadPersistedSession(p.path).catch(() => {})
        )
      );

      if (recentProjects.length > 0) {
        try {
          await openProject(recentProjects[0].path);
        } catch {
          // 上次项目路径可能已不存在，静默跳过
        }
      }
    };
    restore();
  }, []);

  // ============================================
  // 窗口宽度 < 800px 时自动折叠侧边栏
  // ============================================
  useEffect(() => {
    const checkWidth = () => {
      const isNarrow = window.innerWidth < SIDEBAR_AUTO_COLLAPSE_WIDTH;
      const { visible, setVisibility } = useSidebarStore.getState();

      if (isNarrow && visible) {
        userCollapsedRef.current = false;
        setVisibility(false);
      } else if (!isNarrow && !visible && !userCollapsedRef.current) {
        setVisibility(true);
      }
    };

    checkWidth();
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, []);

  return (
    <div
      data-active-panel={activePanel}
      style={{
        width: '100%',
        height: '100%',
        background: 'var(--c-bg)',
        color: 'var(--c-fg)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <WindowTitleBar
        tabs={
          <WorkspaceTabs
            active={activeWorkspace}
            onChange={setActiveWorkspace}
          />
        }
        right={
          <button
            type="button"
            onClick={openSettings}
            className="btn-icon"
            style={{ width: 28, height: 28 }}
            aria-label="打开设置"
            data-testid="open-settings-button"
          >
            {/* 齿轮图标 */}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7Z" stroke="currentColor" strokeWidth="1.8" />
              <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1 1 0 0 0-1.1-.2a1 1 0 0 0-.6.9V20a2 2 0 0 1-4 0v-.2a1 1 0 0 0-.6-.9a1 1 0 0 0-1.1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1 1 0 0 0 .2-1.1a1 1 0 0 0-.9-.6H4a2 2 0 0 1 0-4h.2a1 1 0 0 0 .9-.6a1 1 0 0 0-.2-1.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.1.2H9a1 1 0 0 0 .6-.9V4a2 2 0 0 1 4 0v.2a1 1 0 0 0 .6.9a1 1 0 0 0 1.1-.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1 1 0 0 0-.2 1.1V9c0 .4.2.8.6.9H20a2 2 0 0 1 0 4h-.2a1 1 0 0 0-.9.6Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        }
      />
      {/* 工作区主机：display:none 切换两个工作区，
          ProjectWorkspace 始终挂载（保护 xterm scrollback / Editor session）；
          ProgressShell 按需首次挂载，挂载后同样靠 display:none 保留状态 */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          data-testid="project-workspace-host"
          style={{
            display: activeWorkspace === 'work' ? 'flex' : 'none',
            flex: 1,
            minHeight: 0,
            flexDirection: 'column',
          }}
        >
          <ProjectWorkspace sidebarVisible={sidebarVisible} />
        </div>
        {progressMounted && (
          <div
            data-testid="progress-shell-host"
            style={{
              display: activeWorkspace === 'progress' ? 'flex' : 'none',
              flex: 1,
              minHeight: 0,
              flexDirection: 'column',
            }}
          >
            <Suspense
              fallback={
                <div
                  data-testid="progress-shell-loading"
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--c-fg-muted)',
                    fontSize: 13,
                  }}
                >
                  加载进度模块...
                </div>
              }
            >
              <ProgressShell />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// 顶部 Workspace Tabs（紧贴品牌右侧）
// 极简实现：不引入 clsx；样式贴合现有标题栏文字尺寸 12-13px
// ============================================
interface WorkspaceTabsProps {
  active: 'work' | 'progress';
  onChange: (v: 'work' | 'progress') => void;
}

function WorkspaceTabs({ active, onChange }: WorkspaceTabsProps) {
  const tabBase: React.CSSProperties = {
    border: 'none',
    background: 'transparent',
    color: 'var(--c-fg-muted)',
    cursor: 'pointer',
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 500,
    borderRadius: 6,
    transition: 'background 0.12s, color 0.12s',
  };
  // 用 --c-panel（浮起面板）作为激活背景；--c-surface-* 不存在于现有令牌（见 App.css）
  const activeStyle: React.CSSProperties = {
    background: 'var(--c-panel)',
    color: 'var(--c-fg)',
  };

  return (
    <div role="tablist" data-testid="workspace-tabs" style={{ display: 'flex', gap: 2 }}>
      <button
        type="button"
        role="tab"
        aria-selected={active === 'work'}
        data-testid="workspace-tab-work"
        onClick={() => onChange('work')}
        style={{ ...tabBase, ...(active === 'work' ? activeStyle : {}) }}
      >
        工作区
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === 'progress'}
        data-testid="workspace-tab-progress"
        onClick={() => onChange('progress')}
        style={{ ...tabBase, ...(active === 'progress' ? activeStyle : {}) }}
      >
        进度
      </button>
    </div>
  );
}
