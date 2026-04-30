/**
 * @file wsClient.ts
 * @description 通知 WebSocket 客户端（Phase 12）。
 *
 *              连接流程：
 *               1. POST /api/ws/ticket（带 access token）→ 拿 30s 短期 ticket
 *               2. 打开 ws://host/api/ws/notifications?ticket=<ticket>
 *               3. onmessage：解析 JSON → 调 notificationsStore.pushNotification
 *               4. onclose：若非主动关闭，按指数退避重试（1s, 2s, 4s 最多 3 次）
 *
 *              业务约定（v1）：
 *               - 单向：服务端 → 客户端；客户端不发消息
 *               - 消息帧：{ "id": 123, "userId": ..., "type": ..., ... } —— 直接是 Notification JSON
 *
 *              不做的事：
 *               - 不做心跳：服务端有 60s read deadline + ping/pong；浏览器 WS 自动响应 ping
 *               - 不做"消息缓冲队列"：离线时通知保留在 DB，下次 connect 时调 listNotifications 一次性拉
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { ProgressApiError, getBaseUrl } from './client';
import { issueWSTicket, NotificationSchema, type Notification } from './notifications';

// ============================================
// 内部状态：单例 WS + 重试计数
// ============================================

let currentWS: WebSocket | null = null;
let retryCount = 0;
let manualDisconnect = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

// 最大重试次数；超过后停止（用户重新登录会触发再次连接）
const MAX_RETRIES = 3;

/**
 * 退避延迟（毫秒）：1s, 2s, 4s
 *
 * @param attempt 第几次重试（0-based）
 * @returns 等待毫秒
 */
function backoffMs(attempt: number): number {
  return 1000 * Math.pow(2, attempt);
}

/**
 * 把 http(s):// base URL 转成 ws(s):// 形式。
 *
 * 业务背景：apiFetch BASE_URL 是 http；WS 必须用 ws/wss 协议。
 */
function httpToWs(baseUrl: string): string {
  if (baseUrl.startsWith('https://')) return 'wss://' + baseUrl.slice('https://'.length);
  if (baseUrl.startsWith('http://')) return 'ws://' + baseUrl.slice('http://'.length);
  return baseUrl;
}

/**
 * 连接通知 WS。
 *
 * 业务流程：
 *  1. 若已有连接 → 先 disconnect
 *  2. 调 issueWSTicket 拿短期票据
 *  3. open ws://...?ticket=...
 *  4. onmessage：parse + zod 校验 → onNotification 回调
 *  5. onerror / onclose：自动退避重试（除非已 disconnect）
 *
 * @param onNotification 收到一条通知时的回调（典型是 notificationsStore.pushNotification）
 * @returns Promise<WebSocket | null> —— 连接成功返回 WS 实例；ticket 申请失败返回 null
 */
export async function connectNotificationsWS(
  onNotification: (notif: Notification) => void,
): Promise<WebSocket | null> {
  // 重新连接前清理旧连接
  if (currentWS) {
    disconnectWS();
  }
  manualDisconnect = false;
  retryCount = 0;

  return doConnect(onNotification);
}

/**
 * 内部 connect 实现，用闭包持有 onNotification；重试时复用相同回调。
 */
async function doConnect(
  onNotification: (notif: Notification) => void,
): Promise<WebSocket | null> {
  let ticket: string;
  try {
    const resp = await issueWSTicket();
    ticket = resp.ticket;
  } catch (err) {
    // ticket 申请失败：401 表示需要重新登录，不重试
    if (err instanceof ProgressApiError && err.status === 401) {
      return null;
    }
    // 其它错误尝试退避重试
    scheduleRetry(onNotification);
    return null;
  }

  const wsBase = httpToWs(getBaseUrl());
  const url = `${wsBase}/api/ws/notifications?ticket=${encodeURIComponent(ticket)}`;
  const ws = new WebSocket(url);
  currentWS = ws;

  ws.onmessage = (ev) => {
    try {
      const raw = JSON.parse(ev.data as string);
      const parsed = NotificationSchema.safeParse(raw);
      if (!parsed.success) {
        // schema 漂移：log 但不 push（防止前端用错位数据渲染）
        // eslint-disable-next-line no-console
        console.warn('ws notification schema drift', parsed.error);
        return;
      }
      onNotification(parsed.data);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('ws message parse error', e);
    }
  };

  ws.onopen = () => {
    // 连接成功重置重试计数（让下次断线从头退避）
    retryCount = 0;
  };

  ws.onerror = (e) => {
    // 不在此处主动 close —— 浏览器会触发 onclose 再继续；这里只 log
    // eslint-disable-next-line no-console
    console.warn('ws error', e);
  };

  ws.onclose = () => {
    currentWS = null;
    if (manualDisconnect) {
      return;
    }
    scheduleRetry(onNotification);
  };

  return ws;
}

/**
 * 安排下次重试；超过 MAX_RETRIES 后放弃。
 */
function scheduleRetry(onNotification: (notif: Notification) => void): void {
  if (retryCount >= MAX_RETRIES) {
    // eslint-disable-next-line no-console
    console.warn(`ws retry exhausted after ${MAX_RETRIES} attempts`);
    return;
  }
  const delay = backoffMs(retryCount);
  retryCount += 1;

  if (retryTimer) {
    clearTimeout(retryTimer);
  }
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (!manualDisconnect) {
      void doConnect(onNotification);
    }
  }, delay);
}

/**
 * 主动断开 WS（登出 / 切用户时调用）。
 *
 * 业务背景：onclose 触发 scheduleRetry；先设 manualDisconnect=true 防止重连。
 */
export function disconnectWS(): void {
  manualDisconnect = true;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (currentWS) {
    try {
      currentWS.close();
    } catch {
      // 已关闭或异常状态忽略
    }
    currentWS = null;
  }
  retryCount = 0;
}

/**
 * 测试 / 调试：返回当前 WS 实例（生产代码不应直接用）。
 */
export function _getCurrentWS(): WebSocket | null {
  return currentWS;
}
