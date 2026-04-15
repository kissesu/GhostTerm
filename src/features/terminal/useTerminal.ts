/**
 * @file useTerminal - WebSocket 连接生命周期管理 hook
 * @description 负责建立和维护 xterm.js 到 PTY WebSocket server 的连接。
 *              监听 terminalStore 中的 wsPort/wsToken 变化，自动重建 WebSocket 连接。
 *              连接断开时触发重连逻辑（延迟 1s 防止死循环），返回 WebSocket ref 给 Terminal.tsx。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { useEffect, useRef } from 'react';
import { useTerminalStore } from './terminalStore';

/** useTerminal hook 返回值 */
export interface UseTerminalResult {
  /** WebSocket 实例 ref，Terminal.tsx 传递给 AttachAddon */
  wsRef: React.RefObject<WebSocket | null>;
}

/**
 * useTerminal - 管理 PTY WebSocket 连接
 *
 * 业务逻辑：
 * 1. 监听 wsPort/wsToken 变化，有值时建立 WebSocket 连接
 * 2. onopen：setConnected(true)
 * 3. onclose：setConnected(false) + 延迟 1s 后调用 reconnect()
 * 4. 组件卸载时关闭 WebSocket
 */
export function useTerminal(): UseTerminalResult {
  const wsRef = useRef<WebSocket | null>(null);
  const wsPort = useTerminalStore((s) => s.wsPort);
  const wsToken = useTerminalStore((s) => s.wsToken);
  const setConnected = useTerminalStore((s) => s.setConnected);
  const reconnect = useTerminalStore((s) => s.reconnect);

  // 重连定时器 ref，避免重复重连
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 是否主动关闭（kill 时设为 true，防止触发重连）
  const intentionalCloseRef = useRef(false);

  useEffect(() => {
    // wsPort/wsToken 均有值时才建立连接
    if (!wsPort || !wsToken) return;

    // aborted 标记：effect 被清理后设为 true
    // 解决 React StrictMode 双重挂载：第一次 effect 创建的 WebSocket
    // 在 CONNECTING 状态时被清理，不直接 close（避免浏览器报 "closed before established"），
    // 而是让 onopen 回调检查 aborted 后自行关闭
    let aborted = false;

    // 清理旧的重连定时器
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    // 关闭已有连接
    if (wsRef.current) {
      intentionalCloseRef.current = true;
      try {
        wsRef.current.close();
      } catch {
        // 忽略已失效连接的关闭错误
      }
    }
    intentionalCloseRef.current = false;

    // 建立新连接
    console.info('[terminal] 建立 WebSocket 连接', {
      wsPort,
      tokenPreview: wsToken.slice(0, 8),
    });
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}?token=${wsToken}`);
    ws.binaryType = 'arraybuffer'; // xterm.js AttachAddon 需要 arraybuffer
    wsRef.current = ws;

    ws.onopen = () => {
      if (aborted) {
        // StrictMode 清理后连接才建立成功 → 关闭这个过时连接
        ws.close();
        return;
      }
      console.info('[terminal] WebSocket 已连接');
      setConnected(true);
    };

    ws.onclose = (event) => {
      if (aborted) return; // effect 已清理，不触发重连
      console.warn('[terminal] WebSocket 已关闭', {
        code: event.code,
        intentional: intentionalCloseRef.current,
      });
      setConnected(false);
      // 非主动关闭时，延迟 1s 重连（防止快速循环）
      if (!intentionalCloseRef.current) {
        reconnectTimerRef.current = setTimeout(() => {
          console.info('[terminal] 尝试重连 PTY');
          reconnect().catch(() => {
            // PTY 已不存在，静默失败
            console.error('[terminal] PTY 重连失败');
          });
        }, 1000);
      }
    };

    ws.onerror = () => {
      console.error('[terminal] WebSocket 连接错误');
    };

    return () => {
      aborted = true;
      intentionalCloseRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      // 无论连接是否已建立，都必须立即关闭旧连接。
      // 后端 token 为一次性消费，若保留 CONNECTING 连接，StrictMode 下旧连接
      // 可能先完成握手并消耗 token，导致新连接被静默拒绝。
      if (ws.readyState !== WebSocket.CLOSED) {
        try {
          console.info('[terminal] 清理旧 WebSocket 连接', {
            readyState: ws.readyState,
          });
          ws.close();
        } catch {
          // 忽略浏览器对 CONNECTING 连接 close 的告警或异常
        }
      }
    };
  }, [wsPort, wsToken]); // 依赖 wsPort/wsToken，reconnect 时会变化

  return { wsRef };
}
