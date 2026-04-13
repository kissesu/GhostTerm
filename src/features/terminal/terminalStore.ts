/**
 * @file terminalStore - PTY 终端状态管理
 * @description 管理 PTY 进程生命周期（spawn/kill/reconnect/resize）和 WebSocket 连接状态。
 *              通过 Tauri invoke 调用 Rust 后端 PTY Commands，结果存储在 Zustand store 中。
 *              xterm.js AttachAddon 直接连接 WebSocket（ws://127.0.0.1:{wsPort}?token={wsToken}），
 *              不经过此 store，store 只管理连接元数据。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

/** PTY 创建结果 - 与 Rust PtyInfo 对应 */
interface PtyInfo {
  pty_id: string;
  ws_port: number;
  ws_token: string;
}

/** 终端状态接口 */
export interface TerminalState {
  /** PTY 唯一标识符，null 表示无活动 PTY */
  ptyId: string | null;
  /** WebSocket 服务器端口 */
  wsPort: number | null;
  /** 一次性认证 token */
  wsToken: string | null;
  /** WebSocket 是否已连接 */
  connected: boolean;

  // ============================================
  // 业务操作
  // ============================================

  /** 启动 PTY 进程 */
  spawn: (cwd: string) => Promise<void>;
  /** 关闭 PTY 进程 */
  kill: () => Promise<void>;
  /** 重连：签发新 token，前端重建 WebSocket 连接 */
  reconnect: () => Promise<void>;
  /** 通知 Rust 后端 PTY 窗口尺寸变化 */
  resize: (cols: number, rows: number) => Promise<void>;
  /** 由 useTerminal hook 更新连接状态 */
  setConnected: (v: boolean) => void;
}

/** terminalStore - PTY 终端全局状态 */
export const useTerminalStore = create<TerminalState>((set, get) => ({
  ptyId: null,
  wsPort: null,
  wsToken: null,
  connected: false,

  /**
   * 启动 PTY 进程
   *
   * 调用 Rust spawn_pty_cmd，获取 WebSocket 连接信息存入 store。
   * xterm.js Terminal 组件在拿到 wsPort/wsToken 后建立 WebSocket 连接。
   */
  spawn: async (cwd: string) => {
    // kill 旧 PTY（避免切换项目时 PTY 泄漏）
    const { ptyId: oldPtyId } = get();
    if (oldPtyId) {
      await invoke('kill_pty_cmd', { ptyId: oldPtyId }).catch(() => {
        // 旧 PTY 可能已退出，忽略 kill 错误
      });
    }

    // 使用系统默认 shell（macOS 默认 zsh，Linux 默认 bash）
    const shell = '/bin/zsh';
    const info = await invoke<PtyInfo>('spawn_pty_cmd', { shell, cwd });
    set({
      ptyId: info.pty_id,
      wsPort: info.ws_port,
      wsToken: info.ws_token,
      connected: false,
    });
  },

  /**
   * 关闭 PTY 进程
   *
   * 调用 Rust kill_pty_cmd，清空 store 中的连接状态。
   */
  kill: async () => {
    const { ptyId } = get();
    if (!ptyId) return;
    await invoke('kill_pty_cmd', { ptyId });
    set({ ptyId: null, wsPort: null, wsToken: null, connected: false });
  },

  /**
   * 重连 PTY
   *
   * 调用 Rust reconnect_pty_cmd 签发新 token，
   * useTerminal hook 监听 wsToken 变化后重建 WebSocket 连接。
   */
  reconnect: async () => {
    const { ptyId } = get();
    if (!ptyId) return;
    const info = await invoke<PtyInfo>('reconnect_pty_cmd', { ptyId });
    set({
      wsPort: info.ws_port,
      wsToken: info.ws_token,
      connected: false,
    });
  },

  /**
   * 通知后端 PTY 尺寸变化
   *
   * 由 Terminal.tsx 的 ResizeObserver 在容器尺寸变化时调用。
   */
  resize: async (cols: number, rows: number) => {
    const { ptyId } = get();
    if (!ptyId) return;
    await invoke('resize_pty_cmd', { ptyId, cols, rows });
  },

  /** 更新 WebSocket 连接状态（由 useTerminal hook 调用） */
  setConnected: (v: boolean) => {
    set({ connected: v });
  },
}));
