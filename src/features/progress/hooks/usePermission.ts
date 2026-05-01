/**
 * @file usePermission.ts
 * @description usePermission(perm) — 从 progressPermissionStore 选取单个权限的便捷 hook。
 *              内部直接调用 store.has()，O(1)；PermissionGate 内部也可换用此 hook。
 *              典型用法：
 *                const canUpload = usePermission(PERM.FILE_UPLOAD);
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { useProgressPermissionStore } from '../stores/progressPermissionStore';
import type { Permission } from '../api/permissions';

/**
 * 查询当前用户是否持有指定权限。
 *
 * @param perm - 权限码，来自 PERM 常量或任意 "<resource>:<action>" 字面量
 * @returns true 当 progressPermissionStore 中含有该权限，否则 false
 */
export function usePermission(perm: Permission | string): boolean {
  return useProgressPermissionStore((s) => s.has(perm as Permission));
}
