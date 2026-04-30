/**
 * @file ProgressShell.tsx
 * @description 进度模块外壳（设计稿 1:1 复刻：toolbar + summary + 3 视图 + 详情）。
 *
 *              业务流程：
 *              1. 挂载时若 refreshToken 有但 user/access 没有 → 调 store.refresh + loadMe
 *              2. 未登录（user==null）→ 渲染 <LoginPage />
 *              3. 已登录 + 无选中项目 → ProgressLayout + (KanbanView | ListView | GanttView)
 *              4. 已登录 + 有选中项目 → ProgressLayout + ProjectDetailPage
 *
 *              设计稿契约：所有 progress 子组件都包裹在 .habitatProgress 根作用域下，
 *              CSS 变量（--bg / --bar / --accent 等）只在此作用域生效。
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { useEffect } from 'react';
import { LogOut } from 'lucide-react';

import type { components } from './api/types.gen';
import type { LoginResponsePayload, UserPayload } from './api/schemas';
import { LoginResponseSchema, UserSchema } from './api/schemas';
import { apiFetch, ProgressApiError } from './api/client';
import { useProgressAuthStore } from './stores/progressAuthStore';
import { useProgressUiStore } from './stores/progressUiStore';
import { useNotificationsStore } from './stores/notificationsStore';
import { connectNotificationsWS, disconnectWS } from './api/wsClient';
import LoginPage from './components/LoginPage';
import { ProgressLayout } from './components/ProgressLayout';
import { ProjectListView } from './components/ProjectListView';
import { KanbanView } from './components/KanbanView';
import { GanttView } from './components/GanttView';
import { ProjectDetailPage } from './components/ProjectDetailPage';
import { NotificationBell } from './components/NotificationBell';
import styles from './progress.module.css';

// ============================================
// 类型自检：确保 OpenAPI 生成的类型与 zod schema 对齐
// 在 tsc --noEmit 时被检查；schema drift 会立即报错
// ============================================
type OASUser = components['schemas']['User'];
type OASLoginResponse = components['schemas']['AuthLoginResponse'];

const _userTypeCheck = ((u: UserPayload): OASUser => u) satisfies (u: UserPayload) => OASUser;
const _loginTypeCheck = ((l: LoginResponsePayload): OASLoginResponse => l) satisfies (
  l: LoginResponsePayload,
) => OASLoginResponse;
void _userTypeCheck;
void _loginTypeCheck;

// 引用一次依赖让 IDE / build 跟踪到（真实调用在 store 内）
void apiFetch;
void LoginResponseSchema;
void UserSchema;
void ProgressApiError;

export default function ProgressShell() {
  const user = useProgressAuthStore((s) => s.user);
  const accessToken = useProgressAuthStore((s) => s.accessToken);
  const refreshToken = useProgressAuthStore((s) => s.refreshToken);
  const refresh = useProgressAuthStore((s) => s.refresh);
  const loadMe = useProgressAuthStore((s) => s.loadMe);
  const logout = useProgressAuthStore((s) => s.logout);

  const currentView = useProgressUiStore((s) => s.currentView);
  const selectedProjectId = useProgressUiStore((s) => s.selectedProjectId);

  // 启动时自动恢复会话
  useEffect(() => {
    if (!user && !accessToken && refreshToken) {
      refresh()
        .then(() => loadMe())
        .catch(() => {
          // refresh 失败 store 已自动 clearLocal；此处不做 UI 反馈
        });
    }
  }, [user, accessToken, refreshToken, refresh, loadMe]);

  // 登录后拉通知列表 + 连接 WS
  useEffect(() => {
    if (!user) {
      return;
    }
    const store = useNotificationsStore.getState();
    void store.load();
    void connectNotificationsWS((notif) => {
      useNotificationsStore.getState().pushNotification(notif);
    });
    return () => {
      disconnectWS();
      useNotificationsStore.getState().clear();
    };
  }, [user]);

  // 未登录 → 登录页
  if (!user) {
    return <LoginPage />;
  }

  // 决定主内容
  let mainContent;
  if (selectedProjectId !== null) {
    mainContent = <ProjectDetailPage projectId={selectedProjectId} />;
  } else if (currentView === 'list') {
    mainContent = <ProjectListView />;
  } else if (currentView === 'gantt') {
    mainContent = <GanttView />;
  } else {
    mainContent = <KanbanView />;
  }

  return (
    <div data-testid="progress-shell" className={styles.habitatProgress}>
      {/* 顶部用户栏（设计稿外，沿用项目惯例做用户/通知/退出） */}
      <div className={styles.userbar} data-testid="progress-userbar">
        <NotificationBell />
        <span>{user.displayName ?? user.username}</span>
        <button
          type="button"
          onClick={() => void logout()}
          data-testid="progress-logout"
          className={styles.userbarLogout}
        >
          <LogOut size={12} aria-hidden="true" />
          退出
        </button>
      </div>

      <ProgressLayout>{mainContent}</ProgressLayout>
    </div>
  );
}
