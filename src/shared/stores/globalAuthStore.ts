/**
 * @file globalAuthStore.ts
 * @description GhostTerm 全局认证 store（由原 progressAuthStore 提升）。
 *
 *              全局共享：work / progress / atlas 三大工作区都通过 useGlobalAuthStore 读用户态。
 *
 *              负责 token / user 状态 + 与后端 5 个 auth endpoint 联通：
 *                - login / refresh / logout / loadMe（getMe）
 *
 *              持久化策略：
 *                - accessToken：仅内存，不落任何持久化（避免 XSS 长期持有）
 *                - refreshToken：finding #12 修复后改存系统 keychain（macOS Keychain /
 *                  Windows Credential Manager / Linux Secret Service）；通过 Tauri IPC
 *                  set/get/delete_refresh_token_cmd 三个 command 访问；webview JS 即使
 *                  绕过 CSP + DOMPurify 也无法直接读取 OS keychain。
 *                  应用启动 hydrate() 从 keychain 拉到内存，再调 refresh() 换新 access。
 *                - user：仅内存（loadMe 后填）
 *
 *              旧用户迁移：原 localStorage('progress_refresh_token') 不再读取；
 *              用户首次启动新版本会被识别为"未登录"重新输入凭证，登录后写入 keychain。
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { create } from 'zustand';
import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';

import { apiFetch, ProgressApiError } from '../../features/progress/api/client';
import {
  LoginResponseSchema,
  RefreshResponseSchema,
  UserSchema,
} from '../../features/progress/api/schemas';
import type {
  LoginResponsePayload,
  UserPayload,
} from '../../features/progress/api/schemas';
import { useGlobalPermissionStore } from './globalPermissionStore';
import { useProgressPermissionStore } from '../../features/progress/stores/progressPermissionStore';
import { setSentryUser, clearSentryUser } from '../../sentry';

// ============================================
// keychain 读/写/删 —— 走 Tauri IPC
//
// 设计点：
//  1) 所有函数都是 async：webview 与 Rust 进程之间是异步消息通道，
//     不能像 localStorage 那样同步返回。
//  2) read / clear 容错：keychain 不可用 / 用户拒绝授权时不阻断主流程，
//     吞错并按"无 token / 清理失败"处理；write 不容错—登录后写不进去
//     就让用户立即看到错误，而不是静默丢凭证。
//  3) 测试环境：setup.ts 已全局 vi.mock '@tauri-apps/api/core' 让 invoke
//     成为 vi.fn()；测试用例按需 mockResolvedValueOnce 注入 keychain 状态。
// ============================================
// 安全 review M5：keychain 失败时的内存兜底
//
// 原实现：writeRefresh 失败让 login() 整体抛错 → 用户怎么登都登不进。
// Linux 场景：
//   - headless server / 无 GUI session
//   - libsecret 未安装 / D-Bus session bus 未启动
//   - keyring crate `set_password` 返 PlatformFailure
// dmg/msi 当前不发 AppImage，潜伏低风险但 keyring 3 deps 暗示后续可能给 Linux。
//
// 修法：keychain 失败时 fallback 到模块级 memory（仍比 localStorage 安全 ——
// 关闭 app 即清；用户须每次重启重登），并 console.warn 提示"本次会话不持久"。
// 不让 login() 整体失败，保留可用性。
let memoryRefreshFallback: string | null = null;

async function readRefresh(): Promise<string | null> {
  try {
    const fromKeychain = (await invoke<string | null>('get_refresh_token_cmd')) ?? null;
    // keychain 优先；keychain 返 null 时检查内存兜底（同一进程 lifetime）
    return fromKeychain ?? memoryRefreshFallback;
  } catch (e) {
    console.error('[auth] read refresh from keychain failed (fallback to memory):', e);
    return memoryRefreshFallback;
  }
}

async function writeRefresh(token: string | null): Promise<void> {
  if (token) {
    try {
      await invoke('set_refresh_token_cmd', { token });
      // 写 keychain 成功也同步 memory，让本进程后续 read 一致（单一信源）
      memoryRefreshFallback = token;
    } catch (e) {
      // 安全 review M5：keychain 写失败时不抛，回退到 memory
      // 让用户能登录但当前会话不持久（关 app 即清）；console.warn 让用户感知
      console.warn('[auth] keychain write failed, using in-memory fallback (session not persisted across app restart):', e);
      memoryRefreshFallback = token;
    }
  } else {
    memoryRefreshFallback = null;
    try {
      await invoke('delete_refresh_token_cmd');
    } catch (e) {
      // 清理失败不阻断登出语义（用户视角"我要退出"已达成）
      console.warn('[auth] clear refresh keychain entry failed (non-fatal):', e);
    }
  }
}

// ============================================
// refresh 单飞守卫（module 级）—— 关键：refresh_tokens 表是 single-use rotation
// （migration 0002 rotate_refresh_token NC2），同一 token 第二次消费返 401。
// hydrate 单飞 inflight Promise — 防 StrictMode 双 mount 让 hydrate() 并发跑两次
// 导致两个 readRefresh await 后竞争 set() 覆盖（review M6）。
// 与下方 refreshInflight 同模式，但保护 hydrate 读路径。
let hydrateInflight: Promise<void> | null = null;

// React StrictMode 双 mount 让 AppLayout verify() 并发调 refresh 两次时，
// 第二个请求会被后端误判重放 → 401 → 清掉刚成功的 user，让超管刷新页面后
// 看到 NoPermissionFallback。所有 refresh 路径共享此 inflight。
// ============================================
let refreshInflight: Promise<void> | null = null;

// ============================================
// store state + actions
// ============================================

interface GlobalAuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: UserPayload | null;
  /** 当前是否正在登录 / 加载 me，UI 用于 disable 按钮 */
  loading: boolean;
  /** 最近一次操作的错误信息（登录失败提示等） */
  error: string | null;
  /**
   * 应用启动后是否还在从 keychain 拉 refreshToken。
   *
   * 与"未登录"区分：hydrating=true 时不能展示 LoginPage（用户原话 2026-05-02
   * "页面刷新时会闪现一下登录页面 非常不合理"），AppLayout 改用 splash 等待。
   * 旧版本同步 readRefresh() 让初始 state 已含 refreshToken；改 keychain 后
   * 必须异步等待，否则首屏 refreshToken=null 会触发 LoginPage 闪现。
   */
  hydrating: boolean;

  // ============ actions ============

  /** 应用启动时从系统 keychain 拉 refreshToken 到内存；幂等 */
  hydrate: () => Promise<void>;
  /** 用户名 + 密码登录 */
  login: (username: string, password: string) => Promise<void>;
  /** 用 refreshToken 换新 accessToken；失败会清空 refresh */
  refresh: () => Promise<void>;
  /** 登出：调后端 + 清空本地状态 + 清 keychain */
  logout: () => Promise<void>;
  /** 拉取当前登录用户信息（依赖 accessToken） */
  loadMe: () => Promise<void>;
  /** 清空本地 token / user / error（不调后端） */
  clearLocal: () => Promise<void>;
}

export const useGlobalAuthStore = create<GlobalAuthState>((set, get) => ({
  accessToken: null,
  refreshToken: null,
  user: null,
  loading: false,
  error: null,
  hydrating: true,

  // ----------------------------------------------------------
  // hydrate: 启动时从 keychain 拉 refreshToken
  // 幂等：多次调用安全（StrictMode 双 mount / verify effect 重入都 OK）
  // ----------------------------------------------------------
  async hydrate() {
    // 已经 hydrate 过（refreshToken 已在内存）跳过；hydrating=false 视为已完成
    if (!get().hydrating) return;
    // 安全 review M6：单飞 inflight 防 StrictMode 双 mount 并发竞争
    //
    // 原实现仅 `if (!hydrating) return` 守门，但 readRefresh 是 await，
    // 两个 mount 各自 enter "hydrating=true" 检查后并发 readRefresh，回来
    // 两次 set() 都跑。极端场景：用户在 hydrate 期间已 logout (set refreshToken=null)，
    // 第二次 hydrate 回来用 keychain 旧值覆盖 → 已登出用户复活拿到旧 refreshToken。
    //
    // 修法：模块级 hydrateInflight Promise 单飞；多次 hydrate() 并发只跑一次。
    // 完成后清 inflight 让后续幂等调用仍直接 if(!hydrating) return 跳过。
    if (hydrateInflight) {
      return hydrateInflight;
    }
    hydrateInflight = (async () => {
      try {
        const token = await readRefresh();
        // 重新检查 hydrating，防止 hydrate 期间 logout 已清除 refreshToken
        if (!get().hydrating) return;
        set({ refreshToken: token, hydrating: false });
      } finally {
        hydrateInflight = null;
      }
    })();
    return hydrateInflight;
  },

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
      // 写 keychain 失败必须冒泡 —— 不能登录"成功"却没存住 refresh
      // hydrating 顺便置 false：登录路径与"启动 hydrate"语义合并到位
      await writeRefresh(data.refreshToken);
      set({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        user: data.user,
        loading: false,
        error: null,
        hydrating: false,
      });
      // 同步 Sentry/GlitchTip user scope，让后续 captureException 自动带账号身份
      setSentryUser({ id: data.user.id, username: data.user.username, roleId: data.user.roleId });
      // login 响应的 user 不含 permissions（仅 /api/auth/me 返回）；
      // 立即拉一次 me 让 PermissionGate / usePermission 在登录后第一次渲染就拿到结果
      try {
        const me = await apiFetch('/api/auth/me', { method: 'GET' }, UserSchema);
        // 防御 me 返回 falsy（如测试 mock 未返回 / 后端临时 500）：
        // 此时不覆盖 user 字段，让 login 响应的 user 保留可见，避免 UI 闪退
        if (me) {
          set({ user: me });
          useGlobalPermissionStore.getState().hydrateFromMe(me);
          useProgressPermissionStore.getState().set(me.permissions);
        }
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
    // 单飞复用：StrictMode 双 mount / 多旁路并发 401 时只发一次 /api/auth/refresh
    if (refreshInflight) return refreshInflight;
    refreshInflight = (async () => {
      try {
        const current = get().refreshToken;
        if (!current) {
          throw new ProgressApiError(401, 'unauthorized', 'no refresh token');
        }
        let data;
        try {
          data = await apiFetch(
            '/api/auth/refresh',
            {
              method: 'POST',
              anonymous: true, // refresh 不依赖 access token
              body: JSON.stringify({ refreshToken: current }),
            },
            RefreshResponseSchema,
          );
        } catch (err) {
          // refresh 失败 = refresh token 失效；清空 keychain 与本地 state 避免后续重复尝试
          await writeRefresh(null);
          set({ accessToken: null, refreshToken: null, user: null });
          throw err;
        }
        // 后端 rotate 后的新 refreshToken 必须写回 keychain + state
        // （rotate_refresh_token 单次消费，下次 refresh 必须用新 token）
        await writeRefresh(data.refreshToken);
        set({ accessToken: data.accessToken, refreshToken: data.refreshToken });
      } finally {
        refreshInflight = null;
      }
    })();
    return refreshInflight;
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
      await writeRefresh(null);
      set({ accessToken: null, refreshToken: null, user: null, error: null });
      useGlobalPermissionStore.getState().clear();
      useProgressPermissionStore.getState().clear();
      // 退出后报错不再绑老用户身份
      clearSentryUser();
    }
  },

  // ----------------------------------------------------------
  // loadMe: GET /api/auth/me → user (含 permissions)
  // ----------------------------------------------------------
  async loadMe() {
    const data = await apiFetch('/api/auth/me', { method: 'GET' }, UserSchema);
    set({ user: data });
    useGlobalPermissionStore.getState().hydrateFromMe(data);
    // 与 login 路径 L142 对称：必须 hydrate progressPermissionStore，
    // 否则刷新走 verify→loadMe 路径时 progress PermissionGate 永远隐藏所有按钮
    // （super_admin 也受影响 - 后端返 ['*:*'] 但 store 不 set 就 has() 都 false）
    useProgressPermissionStore.getState().set(data.permissions);
    // 与 login 路径对称：刷新走 verify→loadMe 时也要同步 Sentry user scope
    setSentryUser({ id: data.id, username: data.username, roleId: data.roleId });
  },

  // ----------------------------------------------------------
  // clearLocal: 不调后端，只清本地（用于 401 时强制返回登录页）
  // 改 async：keychain 删除是异步 IPC，调用方必要时可 await 等待清理完成
  // ----------------------------------------------------------
  async clearLocal() {
    await writeRefresh(null);
    set({ accessToken: null, refreshToken: null, user: null, error: null });
    useGlobalPermissionStore.getState().clear();
    // 401 强退后报错不再绑老用户身份（与 logout 对称）
    clearSentryUser();
  },
}));

/**
 * 同步获取当前 access token（apiFetch 在请求前调用）。
 *
 * 与 store 解耦：apiFetch 不直接 import store hook，避免循环依赖。
 */
export function getAccessToken(): string | null {
  return useGlobalAuthStore.getState().accessToken;
}
