/**
 * @file progressPermissionStore.ts
 * @description 进度模块权限检查 store；由 Task 34 在 globalAuthStore login/logout 钩子驱动 set/clear
 *              has(perm) 直接 O(1) Set lookup，PermissionGate 大量复用
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { create } from 'zustand';
import type { Permission } from '../api/permissions';

interface ProgressPermissionState {
  permissions: Set<Permission>;
  set: (perms: readonly (Permission | string)[]) => void;
  has: (perm: Permission | string) => boolean;
  clear: () => void;
}

export const useProgressPermissionStore = create<ProgressPermissionState>((set, get) => ({
  permissions: new Set(),

  set: (perms) => set({ permissions: new Set(perms as Permission[]) }),

  /**
   * 权限查询：支持三档匹配
   * 1. 精确匹配 perm 本身
   * 2. 全局通配 "*:*"（super_admin 后端返回的标识）
   * 3. namespace 通配 "<ns>:*"（如 "event:*" 覆盖 "event:E1"）
   * 任意一档命中即返回 true；perm 含 ":" 时才尝试 ns 通配
   */
  has: (perm) => {
    const perms = get().permissions;
    if (perms.has(perm as Permission)) return true;
    if (perms.has('*:*' as Permission)) return true;
    const colon = perm.indexOf(':');
    if (colon > 0) {
      const ns = perm.slice(0, colon);
      if (perms.has(`${ns}:*` as Permission)) return true;
    }
    return false;
  },

  clear: () => set({ permissions: new Set() }),
}));
