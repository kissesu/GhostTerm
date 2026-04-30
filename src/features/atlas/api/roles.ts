/**
 * @file api/roles.ts
 * @description Atlas 模块角色 + 权限矩阵 API client。
 *
 *              对应后端 RBACHandler 4 个 endpoint：
 *                - GET  /api/permissions             所有权限定义
 *                - GET  /api/roles                   所有角色
 *                - GET  /api/roles/{id}/permissions  某角色已绑定权限
 *                - PATCH /api/roles/{id}/permissions 全量替换某角色权限（仅超管）
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { z } from 'zod';

import { apiFetch } from '../../progress/api/client';

// ============================================
// schemas（手写，避免依赖 progress 模块的 oas types）
// ============================================

export const PermissionSchema = z.object({
  id: z.number().int(),
  resource: z.string(),
  action: z.string(),
  scope: z.string(),
});
export type Permission = z.infer<typeof PermissionSchema>;

const PermissionListSchema = z.array(PermissionSchema);

export const RoleSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string().nullable().optional(),
  isSystem: z.boolean(),
  createdAt: z.string(),
});
export type Role = z.infer<typeof RoleSchema>;

const RoleListSchema = z.array(RoleSchema);

// ============================================
// API 函数
// ============================================

/** GET /api/permissions */
export async function listPermissions(): Promise<Permission[]> {
  return apiFetch('/api/permissions', { method: 'GET' }, PermissionListSchema);
}

/** GET /api/roles */
export async function listRoles(): Promise<Role[]> {
  return apiFetch('/api/roles', { method: 'GET' }, RoleListSchema);
}

/** GET /api/roles/{id}/permissions */
export async function getRolePermissions(roleId: number): Promise<Permission[]> {
  return apiFetch(`/api/roles/${roleId}/permissions`, { method: 'GET' }, PermissionListSchema);
}

/** PATCH /api/roles/{id}/permissions —— 全量替换权限绑定 */
export async function updateRolePermissions(
  roleId: number,
  permissionIds: number[],
): Promise<Permission[]> {
  return apiFetch(
    `/api/roles/${roleId}/permissions`,
    {
      method: 'PATCH',
      body: JSON.stringify({ permissionIds }),
    },
    PermissionListSchema,
  );
}
