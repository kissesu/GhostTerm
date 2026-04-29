/**
 * @file usePermission.ts
 * @description React hook：订阅 progressPermissionStore，返回当前用户对 perm 的判定结果。
 *
 *              用法：
 *                const canCreateProject = usePermission(PERM.PROJECT_CREATE);
 *                if (canCreateProject) { ...render 创建按钮 }
 *
 *              同时导出 useCan(perm) 作为别名，让 JSX 读起来更自然：
 *                {useCan(PERM.EVENT_E10) && <Button>触发收款</Button>}
 *
 *              性能：
 *              - 用 zustand 的 selector 模式，只在 has() 结果变化时重渲染
 *              - 由于 has() 是函数 + 通配匹配，selector 必须返回布尔值（不返回函数）
 *                否则每次 useStore 都会拿到新引用导致无限重渲染
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { useProgressPermissionStore } from '../stores/progressPermissionStore';
import type { Permission } from '../api/permissions';

/**
 * usePermission 返回当前用户对 perm 的判定。
 *
 * @param perm 权限码字符串，如 "project:read" 或 "event:E10"
 * @returns true 表示已授权，false 表示未授权
 */
export function usePermission(perm: Permission): boolean {
  // 注意：选择器返回布尔，不返回 has 函数本身 ——
  // 否则 zustand 默认 reference equality 比对会让组件每帧重渲染
  return useProgressPermissionStore((state) => {
    // 内联实现 has()，避免在 selector 内调用 get()（zustand 推荐）
    const set = state.permissions;
    if (!perm) return false;
    if (set.has('*:*')) return true;
    if (set.has(perm)) return true;
    const colonIdx = perm.indexOf(':');
    if (colonIdx <= 0 || colonIdx === perm.length - 1) return false;
    const resource = perm.slice(0, colonIdx);
    const action = perm.slice(colonIdx + 1);
    if (set.has(`${resource}:*`)) return true;
    if (set.has(`*:${action}`)) return true;
    return false;
  });
}

/**
 * useCan 是 usePermission 的语义别名，让 JSX 更易读：
 *   {useCan('event:E10') && <Button .../>}
 */
export const useCan = usePermission;
