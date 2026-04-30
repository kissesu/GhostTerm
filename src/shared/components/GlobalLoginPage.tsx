/**
 * @file GlobalLoginPage.tsx
 * @description 全局登录页（在 AppLayout 顶层未登录时渲染）。
 *
 *              业务定位：
 *                - 替代原 progress 模块的 LoginPage —— 现在登录是应用级前置门
 *                - 收集 username + password，调 globalAuthStore.login
 *                - 失败回显 store.error；成功后由 AppLayout 自动切到主界面
 *
 *              视觉沿用 progress habitat 设计 tokens（OKLCH 森青调），
 *              通过引入 progress.module.css 的 habitatProgress 根作用域生效。
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { useState, type FormEvent } from 'react';

import { useGlobalAuthStore } from '../stores/globalAuthStore';
import progressStyles from '../../features/progress/progress.module.css';

export default function GlobalLoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const login = useGlobalAuthStore((s) => s.login);
  const loading = useGlobalAuthStore((s) => s.loading);
  const error = useGlobalAuthStore((s) => s.error);

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
      data-testid="global-login-page"
      className={progressStyles.habitatProgress}
      style={loginScreenStyle}
    >
      <form onSubmit={onSubmit} style={loginCardStyle}>
        <h2 style={loginTitleStyle}>
          <span style={loginAccentBarStyle} aria-hidden="true" />
          登录到 GhostTerm
        </h2>

        <label style={labelStyle}>
          <span style={labelTextStyle}>用户名</span>
          <input
            type="text"
            required
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            data-testid="global-login-username"
            style={inputStyle}
          />
        </label>

        <label style={labelStyle}>
          <span style={labelTextStyle}>密码</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="global-login-password"
            style={inputStyle}
          />
        </label>

        {error ? (
          <div
            data-testid="global-login-error"
            style={{
              padding: '8px 12px',
              border: '1px solid rgba(239, 104, 98, 0.4)',
              borderRadius: 6,
              background: 'rgba(239, 104, 98, 0.1)',
              color: '#ffd8d4',
              fontSize: 12,
            }}
          >
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          data-testid="global-login-submit"
          style={{
            height: 36,
            padding: '0 16px',
            borderRadius: 6,
            border: '1px solid transparent',
            background: 'var(--accent)',
            color: 'var(--accent-ink)',
            cursor: loading ? 'wait' : 'pointer',
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: 0.3,
            fontFamily: 'inherit',
          }}
        >
          {loading ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  );
}

// ============================================
// 内联样式（habitat 设计 tokens；与 progress.module.css 同源）
// ============================================

const loginScreenStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 1,
};

const loginCardStyle: React.CSSProperties = {
  width: 340,
  padding: '28px 26px',
  background: 'var(--panel)',
  border: '1px solid var(--line-strong)',
  borderRadius: 10,
  boxShadow: 'var(--shadow)',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const loginTitleStyle: React.CSSProperties = {
  margin: '0 0 4px',
  fontSize: 16,
  fontWeight: 800,
  color: 'var(--text)',
  letterSpacing: 0.3,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const loginAccentBarStyle: React.CSSProperties = {
  width: 28,
  height: 3,
  borderRadius: 2,
  background: 'var(--accent)',
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const labelTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#d8d1bf',
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 36,
  padding: '8px 11px',
  borderRadius: 6,
  border: '1px solid var(--line)',
  background: '#11110f',
  color: 'var(--text)',
  fontSize: 12,
  fontFamily: 'inherit',
  outline: 'none',
};
