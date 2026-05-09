/**
 * @file sentry.ts
 * @description GlitchTip (Sentry 协议兼容) 错误监控初始化。
 *              方案 B 明文 http :38090 起步（5 人 alpha），后续可升级方案 A TLS。
 *              PII 全关 + Authorization/Cookie 自动 scrub，避免敏感数据明文上行。
 * @author Atlas.oi
 * @date 2026-05-09
 */
import * as Sentry from '@sentry/react';

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
