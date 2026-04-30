/**
 * @file progressAuthStore.ts
 * @description 进度模块认证 store（Phase 2 完整版）。
 *
 *              负责 token / user 状态 + 与后端 5 个 auth endpoint 联通：
 *                - login / refresh / logout / loadMe（getMe）
 *
 *              持久化策略（v2 part1 §C7）：
 *                - accessToken：仅内存，不落 localStorage（避免 XSS 长期持有）
 *                - refreshToken：写 localStorage('progress_refresh_token')，
 *                  应用启动调 refresh() 换新 access；refresh 失败则清空
 *                - user：仅内存（loadMe 后填）
 *
 *              不在本文件做的事：
 *                - 不实现 401 → 自动 refresh + retry：跨 store 协调由 client 层下个迭代加
 *                - 不做 SecureStorage：Tauri 桌面端可用 keytar，但 v1 web 部署不一定有原生支持
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { create } from 'zustand';
import { z } from 'zod';

import { apiFetch, ProgressApiError } from '../api/client';
import { LoginResponseSchema, RefreshResponseSchema, UserSchema } from '../api/schemas';
import type { LoginResponsePayload, UserPayload } from '../api/schemas';
import { useProgressPermissionStore } from './progressPermissionStore';

// ============================================
// localStorage key —— 隔离命名空间，避免与其它模块冲突
// ============================================
const REFRESH_KEY = 'progress_refresh_token';

// ============================================
// localStorage 读/写 —— 容错：测试环境若被禁用直接吞错
// ============================================
function readRefresh(): string | null {
  try {
    return globalThis.localStorage?.getItem(REFRESH_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeRefresh(token: string | null): void {
  try {
    if (token) {
      globalThis.localStorage?.setItem(REFRESH_KEY, token);
    } else {
      globalThis.localStorage?.removeItem(REFRESH_KEY);
    }
  } catch {
    // 隐身浏览模式 / 测试 jsdom 关闭 localStorage 时静默忽略
  }
}

// ============================================
// store state + actions
// ============================================

interface ProgressAuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: UserPayload | null;
  /** 当前是否正在登录 / 加载 me，UI 用于 disable 按钮 */
  loading: boolean;
  /** 最近一次操作的错误信息（登录失败提示等） */
  error: string | null;

  // ============ actions ============

  /** 用户名 + 密码登录（用户明确指令覆盖 spec §11） */
  login: (username: string, password: string) => Promise<void>;
  /** 用 refreshToken 换新 accessToken；失败会清空 refresh */
  refresh: () => Promise<void>;
  /** 登出：调后端 + 清空本地状态 + 清 localStorage */
  logout: () => Promise<void>;
  /** 拉取当前登录用户信息（依赖 accessToken） */
  loadMe: () => Promise<void>;
  /** 清空本地 token / user / error（不调后端） */
  clearLocal: () => void;
}

export const useProgressAuthStore = create<ProgressAuthState>((set, get) => ({
  accessToken: null,
  refreshToken: readRefresh(),
  user: null,
  loading: false,
  error: null,

  // ----------------------------------------------------------
  // login: POST /api/auth/login → { accessToken, refreshToken, user }
  // ----------------------------------------------------------
  async login(username, password) {
    set({ loading: true, error: null });
    try {
      const data: LoginResponsePayload = await apiFetch(
        '/api/auth/login',
        {
          method: 'POST',
          anonymous: true, // 登录是公开 endpoint
          body: JSON.stringify({ username, password }),
        },
        LoginResponseSchema,
      );
      writeRefresh(data.refreshToken);
      set({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        user: data.user,
        loading: false,
        error: null,
      });
      // login 响应的 user 不含 permissions（仅 /api/auth/me 返回）；
      // 立即拉一次 me 让 PermissionGate / usePermission 在登录后第一次渲染就拿到结果
      try {
        const me = await apiFetch('/api/auth/me', { method: 'GET' }, UserSchema);
        set({ user: me });
        useProgressPermissionStore.getState().hydrateFromMe(me);
      } catch {
        // 静默忽略：permissions 没 hydrate，PermissionGate 会降级隐藏；不阻断登录
      }
    } catch (err) {
      // 错误暴露给 UI 做提示；同时清空 token 避免半状态
      const msg = err instanceof ProgressApiError ? err.message : String(err);
      set({ accessToken: null, user: null, loading: false, error: msg });
      throw err;
    }
  },

  // ----------------------------------------------------------
  // refresh: POST /api/auth/refresh → { accessToken }
  // ----------------------------------------------------------
  async refresh() {
    const current = get().refreshToken;
    if (!current) {
      throw new ProgressApiError(401, 'unauthorized', 'no refresh token');
    }
    const data = await apiFetch(
      '/api/auth/refresh',
      {
        method: 'POST',
        anonymous: true, // refresh 不依赖 access token
        body: JSON.stringify({ refreshToken: current }),
      },
      RefreshResponseSchema,
    ).catch((err) => {
      // refresh 失败 = refresh token 失效；清空本地 state 避免后续重复尝试
      writeRefresh(null);
      set({ accessToken: null, refreshToken: null, user: null });
      throw err;
    });
    set({ accessToken: data.accessToken });
  },

  // ----------------------------------------------------------
  // logout: POST /api/auth/logout（带 access token）→ 204
  // 即使后端调用失败（例如 token 已过期），也要把本地状态清干净
  // ----------------------------------------------------------
  async logout() {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' }, z.void());
    } catch {
      // 后端失败不阻断本地登出 —— 用户语义就是"我要退出"
    } finally {
      writeRefresh(null);
      set({ accessToken: null, refreshToken: null, user: null, error: null });
      // Phase 3：登出时清空权限缓存，避免下个登录用户看到上个用户的权限
      useProgressPermissionStore.getState().clear();
    }
  },

  // ----------------------------------------------------------
  // loadMe: GET /api/auth/me → { user, permissions }
  //
  // Phase 3：响应 schema 含 permissions: string[]；拉到后立即同步到 permission store，
  // 让 PermissionGate / usePermission 在组件首次渲染时就拿到结果
  // ----------------------------------------------------------
  async loadMe() {
    const data = await apiFetch('/api/auth/me', { method: 'GET' }, UserSchema);
    set({ user: data });
    useProgressPermissionStore.getState().hydrateFromMe(data);
  },

  // ----------------------------------------------------------
  // clearLocal: 不调后端，只清本地（用于 401 时强制返回登录页）
  // ----------------------------------------------------------
  clearLocal() {
    writeRefresh(null);
    set({ accessToken: null, refreshToken: null, user: null, error: null });
    // 同步清空权限 store
    useProgressPermissionStore.getState().clear();
  },
}));

/**
 * 同步获取当前 access token（apiFetch 在请求前调用）。
 *
 * 与 store 解耦：apiFetch 不直接 import store hook，避免循环依赖。
 */
export function getAccessToken(): string | null {
  return useProgressAuthStore.getState().accessToken;
}
