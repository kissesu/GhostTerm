/**
 * @file terminalStore - PTY 终端状态管理
 * @description 管理多项目 PTY 进程生命周期。每个项目独立维护一个 PTY 会话（sessions map），
 *              切换项目时不销毁旧 PTY，仅改变 activeProjectPath。
 *              Rust 后端 PTY_REGISTRY 原生支持多 PTY 并发（HashMap<pty_id, PtyState>）。
 * @author Atlas.oi
 * @date 2026-04-15
 */

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '../../shared/stores/settingsStore';

/** 单个 PTY 会话信息 */
export interface PtySession {
  ptyId: string;
  wsPort: number;
  wsToken: string;
  connected: boolean;
}

/** PTY 创建结果 - 与 Rust PtyInfo 对应 */
interface PtyInfo {
  pty_id: string;
  ws_port: number;
  ws_token: string;
}

type DefaultShell = string;

/** 终端 store 状态接口 */
export interface TerminalState {
  /** 所有已激活项目的 PTY 会话，key = projectPath */
  sessions: Record<string, PtySession>;
  /** 当前激活的项目路径 */
  activeProjectPath: string | null;

  /**
   * 为指定项目 spawn PTY（不 kill 其他项目）
   * 若该项目已有 PTY，先 kill 旧的（重启场景），再创建新的
   */
  spawnForProject: (projectPath: string, cwd: string) => Promise<void>;
  /**
   * 激活指定项目（切换终端焦点）
   * 若项目尚无 PTY，调用 spawnForProject；已有则只更新 activeProjectPath
   */
  activateProject: (projectPath: string) => Promise<void>;
  /** kill 指定项目的 PTY，从 sessions 中移除 */
  killProject: (projectPath: string) => Promise<void>;
  /** 重连指定项目 PTY（签发新 token） */
  reconnect: (projectPath: string) => Promise<void>;
  /**
   * 通知 Rust 后端 PTY 的窗口尺寸变化
   * @param projectPath 可选，指定目标项目路径；省略时使用 activeProjectPath
   */
  resize: (cols: number, rows: number, projectPath?: string) => Promise<void>;
  /** 由 useTerminal hook 更新指定项目的连接状态 */
  setConnected: (projectPath: string, v: boolean) => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: {},
  activeProjectPath: null,

  spawnForProject: async (projectPath: string, cwd: string) => {
    const { sessions } = get();

    // 若该项目已有 PTY，先 kill（重启/重连场景），不影响其他项目
    const existing = sessions[projectPath];
    if (existing) {
      await invoke('kill_pty_cmd', { ptyId: existing.ptyId }).catch(() => {
        // 旧 PTY 可能已退出，忽略错误
      });
    }

    const terminalSettings = useSettingsStore.getState().terminal;
    const shell = terminalSettings.useSystemShell
      ? await invoke<DefaultShell>('get_default_shell_cmd')
      : terminalSettings.customShellPath.trim();

    if (!shell) {
      throw new Error('终端 shell 未配置');
    }

    const info = await invoke<PtyInfo>('spawn_pty_cmd', { shell, cwd });

    set((state) => ({
      sessions: {
        ...state.sessions,
        [projectPath]: {
          ptyId: info.pty_id,
          wsPort: info.ws_port,
          wsToken: info.ws_token,
          connected: false,
        },
      },
    }));
  },

  activateProject: async (projectPath: string) => {
    // 更新活跃项目（Terminal 组件通过 display:none/block 切换）
    set({ activeProjectPath: projectPath });

    // 若项目尚无 PTY 会话，spawn 一个
    if (!get().sessions[projectPath]) {
      await get().spawnForProject(projectPath, projectPath);
    }
  },

  killProject: async (projectPath: string) => {
    const session = get().sessions[projectPath];
    if (!session) return;

    await invoke('kill_pty_cmd', { ptyId: session.ptyId }).catch(() => {});

    set((state) => {
      const next = { ...state.sessions };
      delete next[projectPath];
      return {
        sessions: next,
        activeProjectPath:
          state.activeProjectPath === projectPath ? null : state.activeProjectPath,
      };
    });
  },

  reconnect: async (projectPath: string) => {
    const session = get().sessions[projectPath];
    if (!session) return;

    const info = await invoke<PtyInfo>('reconnect_pty_cmd', { ptyId: session.ptyId });

    set((state) => ({
      sessions: {
        ...state.sessions,
        [projectPath]: {
          ...state.sessions[projectPath]!,
          wsPort: info.ws_port,
          wsToken: info.ws_token,
          connected: false,
        },
      },
    }));
  },

  resize: async (cols: number, rows: number, projectPath?: string) => {
    const { sessions, activeProjectPath } = get();
    // 优先使用显式传入的 projectPath，其次用活跃项目路径
    // 多项目场景下，后台项目连接时需要精确 resize 自己的 PTY，而非活跃 PTY
    const path = projectPath ?? activeProjectPath;
    if (!path) return;
    const session = sessions[path];
    if (!session) return;
    await invoke('resize_pty_cmd', { ptyId: session.ptyId, cols, rows });
  },

  setConnected: (projectPath: string, v: boolean) => {
    set((state) => {
      if (!state.sessions[projectPath]) return state;
      return {
        sessions: {
          ...state.sessions,
          [projectPath]: { ...state.sessions[projectPath]!, connected: v },
        },
      };
    });
  },
}));
