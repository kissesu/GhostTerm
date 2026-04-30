/**
 * @file ProgressShell.tsx
 * @description 进度模块外壳（Phase 2 + Phase 10 + Phase 11）。
 *
 *              业务流程：
 *              1. 挂载时若 refreshToken 有但 user/access 没有 → 调 store.refresh + loadMe
 *              2. 未登录（user==null）→ 渲染 <LoginPage />
 *              3. 已登录 + 无选中项目 → ProgressLayout + (ListView | KanbanView)
 *              4. 已登录 + 有选中项目 → ProgressLayout + ProjectDetailPage
 *
 *              schema 类型自检保持原样：tsc --noEmit 时验证 OpenAPI types 与 zod schema 字段对齐。
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
import { ProjectDetailPage } from './components/ProjectDetailPage';
import { NotificationBell } from './components/NotificationBell';

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

  // ============================================
  // 启动时自动恢复会话：localStorage 有 refresh 但内存无 access → 用 refresh 换 access + loadMe
  // ============================================
  useEffect(() => {
    if (!user && !accessToken && refreshToken) {
      refresh()
        .then(() => loadMe())
        .catch(() => {
          // refresh 失败 store 已自动 clearLocal；此处不做 UI 反馈，让用户落到登录页
        });
    }
  }, [user, accessToken, refreshToken, refresh, loadMe]);

  // ============================================
  // Phase 12：登录后拉通知列表 + 连接 WS 推送通道
  //
  // 业务流程：
  //  1. 登录后调 notifications.load() 一次性拉取最近 20 条
  //  2. 调 connectNotificationsWS() 建立 WS 长连接
  //  3. 登出 / 切用户：useEffect cleanup 调 disconnectWS + notifications.clear
  // ============================================
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

  // 已登录 → 主界面：toolbar + 视图分支
  return (
    <div
      data-testid="progress-shell"
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--c-bg)',
        color: 'var(--c-fg)',
        minHeight: 0,
      }}
    >
      {/* 顶部用户信息 + 退出按钮（紧贴 toolbar 上方；Phase 12 通知中心也加在这里） */}
      <div
        data-testid="progress-userbar"
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: 8,
          padding: '6px 16px',
          borderBottom: '1px solid var(--c-border)',
          background: 'var(--c-panel)',
          fontSize: 12,
          color: 'var(--c-fg-muted)',
        }}
      >
        <NotificationBell />
        <span>{user.displayName ?? user.email}</span>
        <button
          type="button"
          onClick={() => void logout()}
          data-testid="progress-logout"
          style={{
            padding: '4px 8px',
            borderRadius: 4,
            border: '1px solid var(--c-border)',
            background: 'transparent',
            color: 'var(--c-fg)',
            cursor: 'pointer',
            fontSize: 11,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <LogOut size={12} aria-hidden="true" />
          退出
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <ProgressLayout>
          {selectedProjectId !== null ? (
            <ProjectDetailPage projectId={selectedProjectId} />
          ) : currentView === 'list' ? (
            <ProjectListView />
          ) : (
            <KanbanView />
          )}
        </ProgressLayout>
      </div>
    </div>
  );
}
