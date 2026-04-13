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

    // 清理旧的重连定时器
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    // 关闭已有连接
    if (wsRef.current) {
      intentionalCloseRef.current = true;
      wsRef.current.close();
    }
    intentionalCloseRef.current = false;

    // 建立新连接
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}?token=${wsToken}`);
    ws.binaryType = 'arraybuffer'; // xterm.js AttachAddon 需要 arraybuffer
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
    };

    ws.onclose = () => {
      setConnected(false);
      // 非主动关闭时，延迟 1s 重连（防止快速循环）
      if (!intentionalCloseRef.current) {
        reconnectTimerRef.current = setTimeout(() => {
          reconnect().catch(() => {
            // PTY 已不存在，静默失败（不降级，直接暴露状态）
          });
        }, 1000);
      }
    };

    ws.onerror = () => {
      // WebSocket 错误后 onclose 会被触发，错误处理在 onclose 统一处理
    };

    return () => {
      // Effect 清理：组件卸载或依赖项变化时关闭 WebSocket
      intentionalCloseRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      // 仅在连接已建立（OPEN）或正在建立（CONNECTING）时关闭
      // CONNECTING 状态下 close() 会触发 "closed before established" 警告，
      // 但不关闭会导致游离连接，因此仍需关闭
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };
  }, [wsPort, wsToken]); // 依赖 wsPort/wsToken，reconnect 时会变化

  return { wsRef };
}
