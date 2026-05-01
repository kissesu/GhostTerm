/**
 * @file progressAuthStore.ts
 * @description 进度模块登录态快照 - re-export globalAuthStore 的 user 字段
 *              让 progress 子组件不直接耦合 shared/，方便未来重构
 *
 *              实际登录写入 token / 触发 login API 在 globalAuthStore，本文件只做读层 facade
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { useGlobalAuthStore } from '../../../shared/stores/globalAuthStore';

/** 当前用户（null = 未登录） */
export function useCurrentUser() {
  return useGlobalAuthStore((s) => s.user);
}

/** 是否已登录（user 非 null 即视为登录） */
export function useIsLoggedIn(): boolean {
  return useGlobalAuthStore((s) => s.user !== null);
}
