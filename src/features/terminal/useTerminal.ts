/**
 * @file useTerminal - 单项目 WebSocket 连接生命周期管理 hook
 * @description 接受 projectPath 参数，订阅 terminalStore.sessions[projectPath] 的
 *              wsPort/wsToken 变化，建立并维护该项目的 PTY WebSocket 连接。
 *              连接断开时触发重连，返回 WebSocket ref 给 Terminal.tsx。
 * @author Atlas.oi
 * @date 2026-04-15
 */

import { useEffect, useRef } from 'react';
import { useTerminalStore } from './terminalStore';

/** useTerminal hook 返回值 */
export interface UseTerminalResult {
  /** WebSocket 实例 ref，Terminal.tsx 传递给 AttachAddon */
  wsRef: React.RefObject<WebSocket | null>;
}

/**
 * useTerminal - 管理指定项目的 PTY WebSocket 连接
 *
 * 业务逻辑：
 * 1. 从 sessions[projectPath] 读取 wsPort/wsToken
 * 2. 有值时建立 WebSocket 连接
 * 3. onopen：setConnected(projectPath, true)
 * 4. onclose：setConnected(projectPath, false) + 延迟 1s 重连
 * 5. 组件卸载（或项目切换）时关闭 WebSocket
 */
export function useTerminal(projectPath: string): UseTerminalResult {
  const wsRef = useRef<WebSocket | null>(null);

  // 只订阅当前项目的 wsPort/wsToken，避免其他项目变化触发重渲染
  const wsPort = useTerminalStore((s) => s.sessions[projectPath]?.wsPort ?? null);
  const wsToken = useTerminalStore((s) => s.sessions[projectPath]?.wsToken ?? null);
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
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}?token=${wsToken}`);
    ws.binaryType = 'arraybuffer'; // xterm.js AttachAddon 需要 arraybuffer
    wsRef.current = ws;

    ws.onopen = () => {
      if (aborted) {
        // StrictMode 清理后连接才建立成功 → 关闭这个过时连接
        ws.close();
        return;
      }
      setConnected(projectPath, true);
    };

    ws.onclose = () => {
      if (aborted) return; // effect 已清理，不触发重连
      setConnected(projectPath, false);
      // 非主动关闭时，延迟 1s 重连（防止快速循环）
      if (!intentionalCloseRef.current) {
        reconnectTimerRef.current = setTimeout(() => {
          reconnect(projectPath).catch(() => {
            // PTY 已不存在，静默失败
            console.error(`[terminal] ${projectPath} PTY 重连失败`);
          });
        }, 1000);
      }
    };

    ws.onerror = () => {
      console.error(`[terminal] ${projectPath} WebSocket 连接错误`);
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
          ws.close();
        } catch {
          // 忽略浏览器对 CONNECTING 连接 close 的告警或异常
        }
      }
    };
  }, [wsPort, wsToken, projectPath]); // 依赖 wsPort/wsToken/projectPath，任一变化重建连接

  return { wsRef };
}
