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

  /** O(1) lookup；perm 不存在或未登录时返回 false */
  has: (perm) => get().permissions.has(perm as Permission),

  clear: () => set({ permissions: new Set() }),
}));
