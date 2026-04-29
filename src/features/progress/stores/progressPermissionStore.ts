/**
 * @file progressPermissionStore.ts
 * @description 进度模块前端权限码缓存 store（Phase 3）。
 *
 *              数据来源：
 *              - 用户登录后 progressAuthStore.loadMe() 拉到 user.permissions: string[]
 *              - hydrateFromMe() 把数组装入 Set，供 has() O(1) 查询
 *
 *              用法：
 *              - usePermission(perm) hook 订阅本 store 的 has() 结果
 *              - PermissionGate 组件根据 has() 决定是否渲染 children
 *
 *              清空时机：
 *              - 登出 → progressAuthStore.logout() 后调 clear()，避免下个登录用户看到上个用户的权限
 *              - 切换用户 / refresh me 失败 → reset 到空 Set
 *
 *              语义边界：
 *              - 本 store 只缓存"码集合"，不解析 scope（all/member）；scope 由后端 RLS 处理
 *              - has(perm) = 严格字面量比对 + 通配兜底（"*:*" / "<resource>:*" / "*:<action>"）
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { create } from 'zustand';

import type { UserPayload } from '../api/schemas';
import type { Permission } from '../api/permissions';

interface ProgressPermissionState {
  /**
   * 当前用户拥有的权限码集合。
   *
   * 用 Set 而不是数组：has() O(1)；通配匹配仍需遍历但通配条目极少。
   */
  permissions: Set<string>;

  /** 用 user 响应（含 permissions 字段）填充 store */
  hydrateFromMe: (user: Pick<UserPayload, 'permissions'>) => void;

  /** 直接传字符串数组填充（测试便利接口） */
  hydrate: (codes: string[]) => void;

  /** 判断当前用户是否拥有 perm 权限 */
  has: (perm: Permission) => boolean;

  /** 清空（登出 / 切换用户时调用） */
  clear: () => void;
}

export const useProgressPermissionStore = create<ProgressPermissionState>((set, get) => ({
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
    // 1. 通配
    if (set.has('*:*')) return true;
    // 2. 完全匹配
    if (set.has(perm)) return true;
    // 3. 半通配（"resource:*" / "*:action"）
    const colonIdx = perm.indexOf(':');
    if (colonIdx <= 0 || colonIdx === perm.length - 1) {
      // 非合法 "resource:action" 格式 → 只能精确匹配，前面已 false
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
