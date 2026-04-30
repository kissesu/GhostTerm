/**
 * @file LoginPage.tsx
 * @description 进度模块登录页（Phase 2 简化版）。
 *
 *              业务定位：
 *                - 仅在 ProgressShell 中"未登录"分支渲染
 *                - 收集 username + password，调 progressAuthStore.login
 *                - 失败回显 store.error；成功后由 ProgressShell 自动切到主界面
 *
 *              不做的事：
 *                - 不做"忘记密码 / 注册"路径：超管在管理后台创建账户（spec §3.4）
 *                - 不做记住我 / 自动登录：refresh token 持久化由 store 内部承担
 *
 *              用户明确指令覆盖 spec §11：登录字段使用 username 而非 email
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { useState, type FormEvent } from 'react';

import { useProgressAuthStore } from '../stores/progressAuthStore';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const login = useProgressAuthStore((s) => s.login);
  const loading = useProgressAuthStore((s) => s.loading);
  const error = useProgressAuthStore((s) => s.error);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      await login(username, password);
    } catch {
      // 错误已写入 store.error；这里仅吞掉以避免 unhandled rejection
    }
  };

  return (
    <div
      data-testid="progress-login-page"
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--c-bg)',
        color: 'var(--c-fg)',
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: 320,
          padding: 24,
          background: 'var(--c-panel)',
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>登录到进度模块</h2>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          <span>用户名</span>
          <input
            type="text"
            required
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            data-testid="progress-login-username"
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          <span>密码</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="progress-login-password"
            style={inputStyle}
          />
        </label>

        {error ? (
          <div
            data-testid="progress-login-error"
            style={{ fontSize: 12, color: 'var(--c-danger, #d8453b)' }}
          >
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          data-testid="progress-login-submit"
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            border: 'none',
            background: 'var(--c-accent)',
            color: 'var(--c-on-accent, #fff)',
            cursor: loading ? 'wait' : 'pointer',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {loading ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderRadius: 4,
  border: '1px solid var(--c-border)',
  background: 'var(--c-bg)',
  color: 'var(--c-fg)',
  fontSize: 13,
};
