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
import styles from '../progress.module.css';

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

  // 业务背景：登录页位于 ProgressShell 未登录分支，无 .habitatProgress 包裹；
  // 这里手动套上根作用域 className 让 habitat tokens 生效，并在登录卡片
  // 上沿用 panel/line/accent 体系，与登录后界面视觉延续。
  return (
    <div data-testid="progress-login-page" className={styles.habitatProgress} style={loginScreenStyle}>
      <form onSubmit={onSubmit} style={loginCardStyle}>
        <h2 style={loginTitleStyle}>
          <span style={loginAccentBarStyle} aria-hidden="true" />
          登录到进度模块
        </h2>

        <label style={labelStyle}>
          <span style={labelTextStyle}>用户名</span>
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

        <label style={labelStyle}>
          <span style={labelTextStyle}>密码</span>
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
          data-testid="progress-login-submit"
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
