/**
 * @file AppLayout - 应用主布局
 * @description GhostTerm 应用外壳：标题栏 + ProjectWorkspace。
 *              负责启动恢复逻辑、窗口宽度自动折叠侧边栏、键盘快捷键注册。
 *
 *              Task 9 (2026-05-02) 引入 nav 级权限门控：
 *              - 登录后 useGlobalPermissionStore.fetch() 拉 effective permissions
 *              - 三个 tab（work/progress/atlas）按 nav:view:<tab> 权限分别渲染
 *              - 当前 tab 失权时自动切到首个有权 tab
 *              - 三 tab 全无权时全屏渲染 NoPermissionFallback
 *
 * @author Atlas.oi
 * @date 2026-05-02
 */

import { useEffect, useRef, useState, useCallback, lazy, Suspense } from 'react';
import { LogOut } from 'lucide-react';
import { useSidebarStore, useProjectStore } from '../features/sidebar';
import { useKeyboardShortcuts } from '../shared/hooks/useKeyboardShortcuts';
import WindowTitleBar from '../shared/components/WindowTitleBar';
import { useSettingsStore } from '../shared/stores/settingsStore';
import { useGlobalAuthStore } from '../shared/stores/globalAuthStore';
import { useGlobalPermissionStore } from '../shared/stores/globalPermissionStore';
import GlobalLoginPage from '../shared/components/GlobalLoginPage';
import NoPermissionFallback from '../shared/components/NoPermissionFallback';
import { NotificationBell } from '../features/progress/components/NotificationBell';
import { ProjectWorkspace } from './ProjectWorkspace';

// ============================================
// nav 级权限码（与后端 EffectivePermissionsService 返回的码一致）
// 从 permissions 表扫描：resource='nav', action='view', scope=tab 名
// ============================================
const NAV_PERM_WORK = 'nav:view:work';
const NAV_PERM_PROGRESS = 'nav:view:progress';
const NAV_PERM_ATLAS = 'nav:view:atlas';
type WorkspaceTab = 'work' | 'progress' | 'atlas';
const NAV_PERM_BY_TAB: Record<WorkspaceTab, string> = {
  work: NAV_PERM_WORK,
  progress: NAV_PERM_PROGRESS,
  atlas: NAV_PERM_ATLAS,
};

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

  // ============================================
  // 全局权限缓存（Task 9）：从 GET /api/me/effective-permissions 拉取
  // 用 selector 而非 getState() 让 hook 真正订阅 store 变化（避免 LSP unused-locals 误判）
  // ============================================
  const permsInitialized = useGlobalPermissionStore((s) => s.initialized);
  const permsHas = useGlobalPermissionStore((s) => s.has);
  const fetchPerms = useGlobalPermissionStore((s) => s.fetch);
  // permissions / isSuperAdmin 仅用于让 hook 在变更时重渲染（has 闭包结果同步刷新）
  // selector 返回原引用，store 写入新 Set / bool 时重渲；触发 auto-switch effect
  useGlobalPermissionStore((s) => s.permissions);
  useGlobalPermissionStore((s) => s.isSuperAdmin);

  const canSeeWork = permsHas(NAV_PERM_WORK);
  const canSeeProgress = permsHas(NAV_PERM_PROGRESS);
  const canSeeAtlas = permsHas(NAV_PERM_ATLAS);
  const hasAnyNav = canSeeWork || canSeeProgress || canSeeAtlas;

  const [activePanel, setActivePanel] = useState<'editor' | 'terminal'>('editor');
  const userCollapsedRef = useRef(false);

  // ============================================
  // 顶层工作区切换：work（终端+编辑器） / progress（进度模块） / atlas（超管）
  // 切换通过 display:none 而非卸载，保留 xterm scrollback / Editor 状态
  // 子模块按需首次挂载（mounted 标记 true 后保持）
  // 持久化：用户原话 2026-05-02 "页面刷新后会显示第一个 tab 而不是激活的 tab"——
  //         用 localStorage 记住上次 tab，刷新后恢复
  // ============================================
  const [activeWorkspace, setActiveWorkspaceState] = useState<WorkspaceTab>(() => {
    try {
      const v = globalThis.localStorage?.getItem('ghostterm:active-workspace');
      if (v === 'work' || v === 'progress' || v === 'atlas') return v;
    } catch {
      // 隐身模式 / 测试 jsdom 关闭 localStorage
    }
    return 'work';
  });
  const setActiveWorkspace = useCallback((tab: WorkspaceTab) => {
    setActiveWorkspaceState(tab);
    try {
      globalThis.localStorage?.setItem('ghostterm:active-workspace', tab);
    } catch {
      // 隐身模式静默忽略
    }
  }, []);
  const [progressMounted, setProgressMounted] = useState(false);
  const [atlasMounted, setAtlasMounted] = useState(false);
  if (activeWorkspace === 'progress' && !progressMounted) {
    // 在渲染过程中调用 setState 是合法模式（React 会重渲染当前组件而非 schedule）
    setProgressMounted(true);
  }
  if (activeWorkspace === 'atlas' && !atlasMounted) {
    setAtlasMounted(true);
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
  // Task 9：登录后拉取最新 effective permissions（nav 级 tab 门控数据源）
  // 仅在 sessionVerified + user 都就绪后跑一次；切账号 / 登出走 globalAuthStore.clear
  // ============================================
  useEffect(() => {
    if (!sessionVerified || !user) return;
    void fetchPerms();
    // 仅在 user 变化时重拉（切账号场景）；fetchPerms 是稳定 selector 引用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionVerified, user]);

  // ============================================
  // Task 9：activeWorkspace 失去对应 nav 权限时自动切到首个可见 tab
  // 例：管理员撤销当前用户的 nav:view:atlas 后，停留在 atlas tab 的用户被弹回 work
  // hasAnyNav=false 时不动（让上层 NoPermissionFallback 接管全屏）
  // ============================================
  useEffect(() => {
    if (!permsInitialized || !hasAnyNav) return;
    const currentPerm = NAV_PERM_BY_TAB[activeWorkspace];
    if (permsHas(currentPerm)) return;
    // 当前 tab 无权 → 找首个有权 tab
    const fallback: WorkspaceTab | null = canSeeWork
      ? 'work'
      : canSeeProgress
        ? 'progress'
        : canSeeAtlas
          ? 'atlas'
          : null;
    if (fallback && fallback !== activeWorkspace) {
      setActiveWorkspace(fallback);
    }
    // permsHas 是 selector 返回的函数引用；permissions/isSuperAdmin 变化通过订阅触发重渲
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permsInitialized, hasAnyNav, activeWorkspace, canSeeWork, canSeeProgress, canSeeAtlas]);

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
            canSeeWork={canSeeWork}
            canSeeProgress={canSeeProgress}
            canSeeAtlas={canSeeAtlas}
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
      {/* Task 9：权限拉取完成后若任一 nav 都无权限 → 全屏兜底页
          （permsInitialized=true 表示已尝试 fetch；error 路径也算 initialized） */}
      {permsInitialized && !hasAnyNav ? (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <NoPermissionFallback />
        </div>
      ) : (
        // 工作区主机：display:none 切换工作区，
        // ProjectWorkspace 始终挂载（保护 xterm scrollback / Editor session）；
        // ProgressShell / AtlasShell 按需首次挂载，挂载后同样靠 display:none 保留状态
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* 无 work 权限时不渲染（避免 PTY/Editor 启动）；有权限则始终挂载 */}
          {canSeeWork && (
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
          )}
          {canSeeProgress && progressMounted && (
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
          {canSeeAtlas && atlasMounted && (
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
      )}
    </div>
  );
}

// ============================================
// 顶部 Workspace Tabs（紧贴品牌右侧）
// 极简实现：不引入 clsx；样式贴合现有标题栏文字尺寸 12-13px
// Task 9：tab 按 nav:view:* 权限分别门控；canSee* false 时整个 button 不渲染
// ============================================
interface WorkspaceTabsProps {
  active: WorkspaceTab;
  onChange: (v: WorkspaceTab) => void;
  canSeeWork: boolean;
  canSeeProgress: boolean;
  canSeeAtlas: boolean;
}

function WorkspaceTabs({
  active,
  onChange,
  canSeeWork,
  canSeeProgress,
  canSeeAtlas,
}: WorkspaceTabsProps) {
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
      {canSeeWork && (
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
      )}
      {canSeeProgress && (
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
      )}
      {canSeeAtlas && (
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
