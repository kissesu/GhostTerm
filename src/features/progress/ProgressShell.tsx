/**
 * @file ProgressShell.tsx
 * @description 进度模块外壳（Phase 2 - 接入 auth gate）。
 *
 *              业务流程：
 *              1. 挂载时若 refreshToken 有但 user/access 没有 → 调 store.refresh + loadMe
 *              2. 未登录（user==null）→ 渲染 <LoginPage />
 *              3. 已登录 → 渲染主界面占位 + "退出"按钮
 *
 *              auth 之上的真实业务页面在 Phase 4-12 的 worker 阶段陆续接入。
 *
 *              schema 类型自检保持原样：tsc --noEmit 时验证 OpenAPI types 与 zod schema 字段对齐。
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { useEffect } from 'react';
import { Activity, LogOut } from 'lucide-react';

import type { components } from './api/types.gen';
import type { LoginResponsePayload, UserPayload } from './api/schemas';
import { LoginResponseSchema, UserSchema } from './api/schemas';
import { apiFetch, ProgressApiError } from './api/client';
import { useProgressAuthStore } from './stores/progressAuthStore';
import LoginPage from './components/LoginPage';

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

  // 未登录 → 登录页
  if (!user) {
    return <LoginPage />;
  }

  // 已登录 → 主界面占位
  return (
    <div
      data-testid="progress-shell"
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        background: 'var(--c-bg)',
        color: 'var(--c-fg-muted)',
        userSelect: 'none',
      }}
    >
      <Activity size={32} strokeWidth={1.5} aria-hidden="true" />
      <div style={{ fontSize: 14, fontWeight: 500 }}>
        进度模块（已登录: {user.displayName ?? user.email}）
      </div>
      <div style={{ fontSize: 12, opacity: 0.7 }}>
        Phase 2 auth 已就绪，业务页面将随 Worker 阶段陆续上线
      </div>
      <button
        type="button"
        onClick={() => void logout()}
        data-testid="progress-logout"
        style={{
          marginTop: 8,
          padding: '6px 10px',
          borderRadius: 6,
          border: '1px solid var(--c-border)',
          background: 'transparent',
          color: 'var(--c-fg)',
          cursor: 'pointer',
          fontSize: 12,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <LogOut size={14} aria-hidden="true" />
        退出
      </button>
    </div>
  );
}
