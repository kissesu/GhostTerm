/**
 * @file AppLayout - 应用主布局
 * @description GhostTerm 应用外壳：标题栏 + ProjectWorkspace。
 *              负责启动恢复逻辑、窗口宽度自动折叠侧边栏、键盘快捷键注册。
 * @author Atlas.oi
 * @date 2026-04-17
 */

import { useEffect, useRef, useState, useCallback, lazy, Suspense } from 'react';
import { LogOut } from 'lucide-react';
import { useSidebarStore, useProjectStore } from '../features/sidebar';
import { useKeyboardShortcuts } from '../shared/hooks/useKeyboardShortcuts';
import WindowTitleBar from '../shared/components/WindowTitleBar';
import { useSettingsStore } from '../shared/stores/settingsStore';
import { useGlobalAuthStore } from '../shared/stores/globalAuthStore';
import GlobalLoginPage from '../shared/components/GlobalLoginPage';
import { NotificationBell } from '../features/progress/components/NotificationBell';
import { ProjectWorkspace } from './ProjectWorkspace';

// 进度模块按需懒加载：首次切换到「进度」Tab 时才下载 chunk，
// 之后保持挂载（display:none），保留模块内部状态
const ProgressShell = lazy(() => import('../features/progress/ProgressShell'));

// Atlas 模块（超管专用：用户管理/角色权限/系统配置）按需懒加载
const AtlasShell = lazy(() => import('../features/atlas/AtlasShell'));

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

  // 全局认证状态：未登录时整个应用替换为登录页
  const user = useGlobalAuthStore((s) => s.user);
  const refreshToken = useGlobalAuthStore((s) => s.refreshToken);
  const refresh = useGlobalAuthStore((s) => s.refresh);
  const loadMe = useGlobalAuthStore((s) => s.loadMe);
  const logout = useGlobalAuthStore((s) => s.logout);

  const [activePanel, setActivePanel] = useState<'editor' | 'terminal'>('editor');
  const userCollapsedRef = useRef(false);

  // ============================================
  // 顶层工作区切换：work（终端+编辑器） / progress（进度模块） / atlas（超管）
  // 切换通过 display:none 而非卸载，保留 xterm scrollback / Editor 状态
  // 子模块按需首次挂载（mounted 标记 true 后保持）
  // ============================================
  const [activeWorkspace, setActiveWorkspace] = useState<'work' | 'progress' | 'atlas'>('work');
  const [progressMounted, setProgressMounted] = useState(false);
  const [atlasMounted, setAtlasMounted] = useState(false);
  if (activeWorkspace === 'progress' && !progressMounted) {
    // 在渲染过程中调用 setState 是合法模式（React 会重渲染当前组件而非 schedule）
    setProgressMounted(true);
  }
  if (activeWorkspace === 'atlas' && !atlasMounted) {
    setAtlasMounted(true);
  }

  // 非 admin 切回 work（防止 roleId 被踢下线后仍停留在 atlas）
  const isAdmin = user?.roleId === 1;
  if (activeWorkspace === 'atlas' && !isAdmin) {
    setActiveWorkspace('work');
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
  // 用户需求 2026-04-30：启动时全局校验登录态（任何 tab 都要先验证），未完成前显示 LoginPage。
  // 之前 work tab 不调后端纯前端 → 即使 token 过期也能用，切到 progress 才挡门
  // ============================================
  const [sessionVerified, setSessionVerified] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const verify = async () => {
      // 已有 user：直接通过（之前已校验过）
      if (user) {
        if (!cancelled) setSessionVerified(true);
        return;
      }
      // 有 refreshToken 但无 access：尝试 refresh + loadMe
      if (refreshToken) {
        try {
          await refresh();
          await loadMe();
        } catch {
          // refresh 失败 store 已自清
        }
      }
      // 完全没 token：跳过验证直接挡门
      if (!cancelled) setSessionVerified(true);
    };
    void verify();
    return () => {
      cancelled = true;
    };
    // 仅在 mount 时跑一次；user 后续变化由其他 effect 管
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================
  // 启动时恢复上次打开的项目（仅在已登录后才有意义）
  // ============================================
  useEffect(() => {
    if (!user) return;
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
  }, [user]);

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

  // ============================================
  // 全局登录门：未登录或 session 验证未完成直接返回登录页
  // ============================================
  if (!sessionVerified || !user) {
    return (
      <div
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
        <WindowTitleBar showBrand />
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <GlobalLoginPage />
        </div>
      </div>
    );
  }

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
            isAdmin={isAdmin}
          />
        }
        right={
          <UserBar
            displayName={user.displayName ?? user.username}
            onLogout={() => void logout()}
            onOpenSettings={openSettings}
          />
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
        {atlasMounted && isAdmin && (
          <div
            data-testid="atlas-shell-host"
            style={{
              display: activeWorkspace === 'atlas' ? 'flex' : 'none',
              flex: 1,
              minHeight: 0,
              flexDirection: 'column',
            }}
          >
            <Suspense
              fallback={
                <div
                  data-testid="atlas-shell-loading"
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--c-fg-muted)',
                    fontSize: 13,
                  }}
                >
                  加载 Atlas 模块...
                </div>
              }
            >
              <AtlasShell />
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
// 角色过滤：所有用户看 work + progress；admin（roleId==1）额外看 atlas
// ============================================
interface WorkspaceTabsProps {
  active: 'work' | 'progress' | 'atlas';
  onChange: (v: 'work' | 'progress' | 'atlas') => void;
  isAdmin: boolean;
}

function WorkspaceTabs({ active, onChange, isAdmin }: WorkspaceTabsProps) {
  // 用户需求 2026-04-30：激活态对齐 progress 模块"看板/列表/Gantt"风格 = OKLCH 森青 accent 实底 + 暗文 + 加粗
  const tabBase: React.CSSProperties = {
    border: 'none',
    background: 'transparent',
    color: 'var(--c-fg-muted)',
    cursor: 'pointer',
    padding: '5px 12px',
    fontSize: 12,
    fontWeight: 700,
    borderRadius: 6,
    fontFamily: 'inherit',
    transition: 'background 0.12s, color 0.12s',
  };
  const activeStyle: React.CSSProperties = {
    background: 'oklch(70% 0.13 175)',
    color: 'oklch(15% 0.005 175)',
    fontWeight: 800,
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
      {isAdmin && (
        <button
          type="button"
          role="tab"
          aria-selected={active === 'atlas'}
          data-testid="workspace-tab-atlas"
          onClick={() => onChange('atlas')}
          style={{ ...tabBase, ...(active === 'atlas' ? activeStyle : {}) }}
        >
          Atlas
        </button>
      )}
    </div>
  );
}

// ============================================
// 用户栏（标题栏右侧）：通知铃 + 用户名 + 退出 + 设置齿轮
// 顺序（左→右）：bell · 用户名 · 退出 · 齿轮
// ============================================
interface UserBarProps {
  displayName: string;
  onLogout: () => void;
  onOpenSettings: () => void;
}

function UserBar({ displayName, onLogout, onOpenSettings }: UserBarProps) {
  return (
    <div
      data-testid="global-userbar"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {/* 用户需求 2026-04-30：齿轮在通知中心左侧（顺序左→右：齿轮 · 铃铛 · 用户名 · 退出） */}
      <button
        type="button"
        onClick={onOpenSettings}
        className="btn-icon"
        style={{ width: 28, height: 28 }}
        aria-label="打开设置"
        data-testid="open-settings-button"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1 1 0 0 0-1.1-.2a1 1 0 0 0-.6.9V20a2 2 0 0 1-4 0v-.2a1 1 0 0 0-.6-.9a1 1 0 0 0-1.1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1 1 0 0 0 .2-1.1a1 1 0 0 0-.9-.6H4a2 2 0 0 1 0-4h.2a1 1 0 0 0 .9-.6a1 1 0 0 0-.2-1.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.1.2H9a1 1 0 0 0 .6-.9V4a2 2 0 0 1 4 0v.2a1 1 0 0 0 .6.9a1 1 0 0 0 1.1-.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1 1 0 0 0-.2 1.1V9c0 .4.2.8.6.9H20a2 2 0 0 1 0 4h-.2a1 1 0 0 0-.9.6Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <NotificationBell />

      <span
        data-testid="global-userbar-name"
        style={{
          fontSize: 12,
          color: 'var(--c-fg-muted)',
          fontWeight: 600,
          padding: '0 4px',
          maxWidth: 120,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={displayName}
      >
        {displayName}
      </span>

      <button
        type="button"
        onClick={onLogout}
        data-testid="global-logout"
        title="退出登录"
        aria-label="退出登录"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          height: 26,
          padding: '0 8px',
          border: '1px solid var(--c-border-sub)',
          borderRadius: 6,
          background: 'transparent',
          color: 'var(--c-fg-muted)',
          fontSize: 11,
          fontFamily: 'inherit',
          cursor: 'pointer',
        }}
      >
        <LogOut size={12} aria-hidden="true" />
        退出
      </button>

    </div>
  );
}
