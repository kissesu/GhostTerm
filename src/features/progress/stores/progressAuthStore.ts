/**
 * @file progressAuthStore.ts
 * @description 进度模块认证状态占位 store。
 *
 *              Phase 0d 仅暴露 accessToken / setAccessToken / clearToken 供 apiFetch
 *              注入 Bearer header；完整登录、refresh、token_version 等流程在 Phase 2
 *              （JWT 认证）中实现，届时替换为带 persist + refresh 流转的版本。
 *
 *              不持久化 token 是有意为之：Phase 0d 没有真实后端可联通，避免假数据
 *              污染本地存储；Phase 2 接入登录 endpoint 后再决定 SecureStorage 落盘。
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { create } from 'zustand';

interface ProgressAuthState {
  /** 当前 access token；未登录时为 null */
  accessToken: string | null;
  /** 写入新的 access token（登录或 refresh 成功后调用） */
  setAccessToken: (token: string) => void;
  /** 清空 access token（登出/refresh 失败后调用） */
  clearToken: () => void;
}

export const useProgressAuthStore = create<ProgressAuthState>((set) => ({
  accessToken: null,
  setAccessToken: (token) => set({ accessToken: token }),
  clearToken: () => set({ accessToken: null }),
}));

/**
 * 获取当前 access token 的同步函数（apiFetch 在请求前调用）。
 *
 * 抽出独立函数而非直接读 store 是为了：
 * 1. 保持 apiFetch 与具体 store 实现解耦，Phase 2 替换 store 时无须改 client
 * 2. 便于在测试中通过 mock 该 hook 注入临时 token
 */
export function getAccessToken(): string | null {
  return useProgressAuthStore.getState().accessToken;
}
