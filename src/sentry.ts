/**
 * @file sentry.ts
 * @description GlitchTip (Sentry 协议兼容) 错误监控初始化。
 *              方案 B 明文 http :38090 起步（5 人 alpha），后续可升级方案 A TLS。
 *              PII 全关 + Authorization/Cookie 自动 scrub，避免敏感数据明文上行。
 *              setSentryUser 让 GlitchTip Issue 显示哪个账号触发，便于 5 人内部诊断。
 * @author Atlas.oi
 * @date 2026-05-09
 */
import * as Sentry from '@sentry/react';
import { invoke } from '@tauri-apps/api/core';

/**
 * 角色 id → 中文名（与 server migrations/0001_init.up.sql roles 表 seed 一致）
 *
 * 业务背景：JWT claim 仅含 user_id + role_id（数字），不带 username/role_name；
 * 前端 setSentryUser 时把 role_id 翻成可读中文让 GlitchTip Issue 列表 user 字段
 * 直接显示"超管"/"开发"/"客服"而不是 role_id=1/2/3。
 *
 * 5 人 alpha 角色集稳定；新增角色（极罕见）需在此字典补一行 + server roles 表插入。
 */
const ROLE_NAME_BY_ID: Record<number, string> = {
  1: '超管',
  2: '开发',
  3: '客服',
};

function roleNameOf(roleId: number): string {
  return ROLE_NAME_BY_ID[roleId] ?? `role_${roleId}`;
}

/**
 * 初始化 GlitchTip / Sentry SDK。
 *
 * 业务流程：
 * 1. 读 VITE_SENTRY_DSN（未配置时静默跳过，dev/test 不强求）
 * 2. 设 sendDefaultPii=false 让 SDK 不发送 IP / cookie / 默认 PII
 * 3. autoSessionTracking=false 因 GlitchTip 不支持 session
 * 4. beforeSend 钩子双保险删 Authorization / Cookie header
 *
 * @example
 *   // main.tsx 顶部调用，必须在 ReactDOM.createRoot 之前
 *   initSentry();
 */
export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: `ghostterm@${import.meta.env.VITE_APP_VERSION ?? '0.0.0'}`,
    sendDefaultPii: false,
    // GlitchTip 不支持 Sentry session tracking；@sentry/react v10 已删 autoSessionTracking 选项，无需显式关
    tracesSampleRate: 0.01,
    beforeSend(event) {
      // 双保险脱敏：sendDefaultPii=false 已过滤大部分 PII，这里再删 auth/cookie 防 SDK 升级行为变化
      const headers = event.request?.headers as Record<string, string> | undefined;
      if (headers) {
        delete headers.Authorization;
        delete headers.authorization;
        delete headers.Cookie;
        delete headers.cookie;
      }
      return event;
    },
  });
}

export const SentryErrorBoundary = Sentry.ErrorBoundary;

/**
 * 把当前登录用户身份同步到 Sentry/GlitchTip + Tauri Rust 进程级 scope。
 *
 * 业务流程：
 *  1. 前端 webview Sentry SDK 设 scope.user = { id, username, role }
 *     —— 后续所有 captureException 自动带 user
 *  2. invoke Tauri Rust set_sentry_user_cmd 让 Rust 端 panic 上报也带同一 user
 *     —— 三侧统一身份（前端 + Tauri + 不含 server，server 仅 id+role_id）
 *
 * 调用时机：globalAuthStore.login 成功后 / loadMe 拿到 user 后
 *
 * @param user 登录用户对象（来自 LoginResponse.user 或 /api/auth/me）
 */
export function setSentryUser(user: {
  id: number;
  username: string;
  roleId: number;
}): void {
  const role = roleNameOf(user.roleId);
  // 前端 webview SDK
  Sentry.setUser({
    id: String(user.id),
    username: user.username,
    // role 是 GlitchTip 自定义字段（schema 允许任意键），用于按角色过滤 issue
    role,
  });
  // Tauri Rust 进程级（panic / Rust 报错通道）
  void invoke('set_sentry_user_cmd', {
    id: user.id,
    username: user.username,
    role,
  }).catch((e) => {
    // 不阻断登录主流程；监控失败 console.warn 让 dev 感知
    console.warn('[sentry] set_sentry_user_cmd failed:', e);
  });
}

/**
 * 清除 Sentry/GlitchTip user scope（登出 / clearLocal 时调）。
 *
 * 让退出后的报错不再绑老用户身份。
 */
export function clearSentryUser(): void {
  Sentry.setUser(null);
  void invoke('clear_sentry_user_cmd').catch((e) => {
    console.warn('[sentry] clear_sentry_user_cmd failed:', e);
  });
}
