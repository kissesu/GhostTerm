/**
 * @file api/roles.ts
 * @description Atlas 模块角色 + 权限矩阵 API client。
 *
 *              对应后端 RBACHandler / PermissionsHandler 4 个 endpoint：
 *                - GET  /api/permissions             所有权限定义（含 3 段 code）
 *                - GET  /api/roles                   所有角色
 *                - GET  /api/roles/{id}/permissions  某角色已绑定权限
 *                - PUT  /api/roles/{id}/permissions  全量替换某角色权限（仅超管，204）
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { z } from 'zod';

import { apiFetch } from '../../progress/api/client';

// ============================================
// schemas（手写，避免依赖 progress 模块的 oas types）
// ============================================

// Permission：与 OAS Permission 对齐。Task 7 起 code 字段必返；其它字段保持兼容。
export const PermissionSchema = z.object({
  id: z.number().int(),
  resource: z.string(),
  action: z.string(),
  scope: z.string(),
  code: z.string(),
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

/** PUT /api/roles/{id}/permissions —— 全量替换权限绑定（Task 7：响应改为 204，
 * 不返回新列表；调用方需要在写后自己重拉 GET /api/roles/{id}/permissions）
 *
 * 业务背景：与原 PATCH 实现差异：
 *   - HTTP 方法 PATCH → PUT（语义更准：全量替换，不是局部 patch）
 *   - 状态码 200 + 列表 → 204 + 空 body
 *   - 后端写路径会同事务 bump 该 role 全部用户的 token_version；写完前端必须强制
 *     重拉 effective-permissions（否则旧 access token 401 时才被动 refresh）
 */
export async function updateRolePermissions(
  roleId: number,
  permissionIds: number[],
): Promise<void> {
  await apiFetch(
    `/api/roles/${roleId}/permissions`,
    {
      method: 'PUT',
      body: JSON.stringify({ permissionIds }),
    },
    z.void(),
  );
}
