/**
 * @file globalPermissionStore.ts
 * @description GhostTerm 全局权限码缓存 store（由原 progressPermissionStore 提升）。
 *
 *              数据来源：
 *              - 用户登录后 globalAuthStore.loadMe() 拉到 user.permissions: string[]
 *              - hydrateFromMe() 把数组装入 Set，供 has() O(1) 查询
 *
 *              用法：
 *              - usePermission(perm) hook 订阅本 store 的 has() 结果
 *              - PermissionGate 组件根据 has() 决定是否渲染 children
 *
 *              清空时机：
 *              - 登出 → globalAuthStore.logout() 后调 clear()，避免下个登录用户看到上个用户的权限
 *
 *              语义边界：
 *              - 本 store 只缓存"码集合"，不解析 scope（all/member）；scope 由后端 RLS 处理
 *              - has(perm) = 严格字面量比对 + 通配兜底（"*:*" / "<resource>:*" / "*:<action>"）
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { create } from 'zustand';

import type { UserPayload } from '../../features/progress/api/schemas';
import type { Permission } from '../../features/progress/api/permissions';

interface GlobalPermissionState {
  /** 当前用户拥有的权限码集合 */
  permissions: Set<string>;
  hydrateFromMe: (user: Pick<UserPayload, 'permissions'>) => void;
  hydrate: (codes: string[]) => void;
  has: (perm: Permission) => boolean;
  clear: () => void;
}

export const useGlobalPermissionStore = create<GlobalPermissionState>((set, get) => ({
  permissions: new Set<string>(),

  hydrateFromMe(user) {
    const codes = user.permissions ?? [];
    set({ permissions: new Set(codes) });
  },

  hydrate(codes) {
    set({ permissions: new Set(codes) });
  },

  has(perm) {
    if (!perm) return false;
    const set = get().permissions;
    if (set.has('*:*')) return true;
    if (set.has(perm)) return true;
    const colonIdx = perm.indexOf(':');
    if (colonIdx <= 0 || colonIdx === perm.length - 1) {
      return false;
    }
    const resource = perm.slice(0, colonIdx);
    const action = perm.slice(colonIdx + 1);
    if (set.has(`${resource}:*`)) return true;
    if (set.has(`*:${action}`)) return true;
    return false;
  },

  clear() {
    set({ permissions: new Set<string>() });
  },
}));
