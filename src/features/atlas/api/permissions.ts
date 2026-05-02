/**
 * @file api/permissions.ts
 * @description Atlas 权限管理 API client（Task 7 引入的 6 个 OAS endpoint 的薄包装）。
 *
 *              对应后端 PermissionsHandler 的 6 个端点：
 *                - GET  /api/permissions                              全量权限字典（catalog）
 *                - GET  /api/me/effective-permissions                 当前用户有效权限码 + superAdmin 标记
 *                - GET  /api/roles/{id}/permissions                   单角色 grant 列表
 *                - PUT  /api/roles/{id}/permissions                   全量替换角色权限（204）
 *                - GET  /api/users/{id}/permission-overrides          单用户 grant/deny 覆写列表
 *                - PUT  /api/users/{id}/permission-overrides          全量替换用户覆写（204）
 *
 *              wire 格式分两类（spec OAS 决定）：
 *                A. 包在 DataEnvelope { data: T } 里：/api/permissions、/api/roles/{id}/permissions
 *                   → 直接走 client.ts::apiFetch（apiFetch 会自动剥 envelope）
 *                B. 顶层就是业务对象（不带 data 包裹）：
 *                   - /api/me/effective-permissions    EffectivePermissionsResponse{permissions, superAdmin}
 *                   - /api/users/{id}/permission-overrides UserPermissionOverridesResponse{userId, overrides}
 *                   → apiFetch 不能直接用（会把顶层字段当作 data 缺失），自实现 doFetch 复用
 *                     silentRefreshOnce + getBaseUrl 与 apiFetch 同源
 *
 *              不重叠职责：
 *                - 与 src/features/atlas/api/roles.ts 并存：roles.ts 是 Task 6 的旧 PATCH 链路 +
 *                  catalog 查询（已被 Task 7 PUT 替换），保留供 atlasRolesStore 使用
 *                - 本文件给 Task 10 RolePermissionMatrix（单角色聚焦视图）+ Task 11
 *                  UserPermissionOverridePanel + Task 9 globalPermissionStore 共同复用
 *
 * @author Atlas.oi
 * @date 2026-05-02
 */

import { z } from 'zod';

import { getAccessToken } from '../../../shared/stores/globalAuthStore';
import {
  apiFetch,
  getBaseUrl,
  ProgressApiError,
  silentRefreshOnce,
} from '../../progress/api/client';

// ============================================================================
// 通用：错误 envelope schema（与 client.ts 私有的同结构；本地复制以便独立 doFetch 用）
// ============================================================================

const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

// ============================================================================
// PermissionDTO + 列表 schema
// ============================================================================

/**
 * Permission DTO（与 OAS components.schemas.Permission 对齐）。
 *
 * 注意 code 字段是后端 toOAS 时 `resource:action:scope` 拼接的便捷副本，
 * 用于前端按字符串匹配权限门控；无需自行拼接。
 */
export const PermissionSchema = z.object({
  id: z.number().int(),
  resource: z.string(),
  action: z.string(),
  scope: z.string(),
  code: z.string(),
});
export type PermissionDTO = z.infer<typeof PermissionSchema>;

const PermissionListSchema = z.array(PermissionSchema);

// ============================================================================
// UserPermissionOverride DTO + 列表 schema
// ============================================================================

/**
 * 用户级权限覆写：grant 表示在 role 默认基础上额外授予；deny 表示在 role 默认基础上
 * 显式撤销。effect 字符串与后端 services.UserOverride.Effect 一致。
 */
export const UserPermissionOverrideSchema = z.object({
  permissionId: z.number().int(),
  effect: z.enum(['grant', 'deny']),
});
export type UserPermissionOverrideDTO = z.infer<typeof UserPermissionOverrideSchema>;

const UserPermissionOverridesResponseSchema = z.object({
  userId: z.number().int(),
  overrides: z.array(UserPermissionOverrideSchema),
});

// ============================================================================
// EffectivePermissionsResponse DTO
// ============================================================================

/**
 * 当前登录用户的"已合并有效权限码列表"。
 *
 * - permissions：每个元素形如 "resource:action:scope" 或单元素 ["*:*"]（超管哨兵）
 * - superAdmin：true 时前端可跳过任何 PermissionGate；与 permissions==["*:*"] 等价
 *   （后端冗余返回避免前端做哨兵字符串比较）
 */
export const EffectivePermissionsSchema = z.object({
  permissions: z.array(z.string()),
  superAdmin: z.boolean(),
});
export type EffectivePermissionsDTO = z.infer<typeof EffectivePermissionsSchema>;

// ============================================================================
// 类型 A：apiFetch 路径（响应已被 DataEnvelope 包裹）
// ============================================================================

/**
 * GET /api/permissions —— 拉取全量权限字典。
 *
 * 业务背景：权限矩阵 UI（Task 10）需要展示所有可分配的 permission，否则用户
 * 无法选择"想要授予哪些权限"。后端权限码 catalog 静态，前端可缓存到 store。
 */
export async function listAllPermissions(): Promise<PermissionDTO[]> {
  return apiFetch('/api/permissions', { method: 'GET' }, PermissionListSchema);
}

/**
 * GET /api/roles/{id}/permissions —— 拉取单角色已绑定的权限列表。
 */
export async function getRolePermissions(roleId: number): Promise<PermissionDTO[]> {
  return apiFetch(`/api/roles/${roleId}/permissions`, { method: 'GET' }, PermissionListSchema);
}

/**
 * PUT /api/roles/{id}/permissions —— 全量替换角色权限绑定（204）。
 *
 * 业务背景：写后后端在同事务 bump 该 role 全部用户的 token_version；前端需在
 * 写完后强制重拉 effective-permissions（否则旧 access token 401 时才被动 refresh）。
 *
 * @param roleId 目标角色 ID（super_admin role_id=1 必被 422 拒绝）
 * @param permissionIds 期望绑定的全量 permission ID 列表（不在列表中的现有绑定将被删除）
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

// ============================================================================
// 类型 B：自实现 fetch（响应不带 DataEnvelope 包裹）
// ============================================================================

/**
 * GET /api/users/{id}/permission-overrides —— 拉取单用户的 grant/deny 覆写列表。
 *
 * 仅 super_admin 可调（后端 permissions:user_override:manage 权限）。
 */
export async function getUserPermissionOverrides(
  userId: number,
): Promise<UserPermissionOverrideDTO[]> {
  const path = `/api/users/${userId}/permission-overrides`;
  const body = await fetchUnwrapped(path, { method: 'GET' }, UserPermissionOverridesResponseSchema);
  return body.overrides;
}

/**
 * PUT /api/users/{id}/permission-overrides —— 全量替换用户覆写（204）。
 *
 * 业务背景：写后后端会 bump 该用户的 token_version，让旧 access token 失效；
 * 前端需要强制重拉 effective-permissions 让 UI gate 跟随生效。
 *
 * @param userId 目标用户 ID（super_admin user_id=1 必被 422 拒绝）
 * @param overrides 期望的全量覆写集合（不在列表中的现有覆写将被删除）
 */
export async function updateUserPermissionOverrides(
  userId: number,
  overrides: UserPermissionOverrideDTO[],
): Promise<void> {
  const path = `/api/users/${userId}/permission-overrides`;
  await fetchUnwrappedVoid(path, {
    method: 'PUT',
    body: JSON.stringify({ overrides }),
  });
}

/**
 * GET /api/me/effective-permissions —— 拉取当前登录用户的有效权限码列表。
 *
 * 业务背景：与 PermissionGate / AppLayout tab 渲染绑定，权限变更后必须强制重拉
 * （旧 access token 401 → silent refresh → 重拉本接口取最新集合）。不能加缓存，
 * 不应对 401 做"假如未登录"降级（client.ts apiFetch 已实现 401 自愈）。
 */
export async function getMyEffectivePermissions(): Promise<EffectivePermissionsDTO> {
  const path = `/api/me/effective-permissions`;
  return fetchUnwrapped(path, { method: 'GET' }, EffectivePermissionsSchema);
}

// ============================================================================
// 私有 helpers：自实现 fetch（复用 silentRefreshOnce 与 apiFetch 等价）
// ============================================================================

/**
 * 发起一次 fetch（带 Authorization Bearer + Content-Type:application/json）。
 *
 * 与 client.ts 私有的 doFetch 同行为；本文件复制一份是为了让无 DataEnvelope 的
 * 响应也能复用 401 silent refresh，而不用让 client.ts 暴露内部 helper。
 */
async function doFetch(path: string, init: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  const token = getAccessToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return fetch(`${getBaseUrl()}${path}`, { ...init, headers });
}

/**
 * 通用：发起请求 + 401 silent refresh + zod 校验"顶层就是业务对象"的响应。
 *
 * 业务流程：
 *   1. 第一次请求；401 → silentRefreshOnce → 重试一次
 *   2. 非 2xx → 解析 ErrorEnvelope → ProgressApiError
 *   3. 2xx → schema.parse；漂移抛 schema_drift（与 apiFetch 行为对齐）
 */
async function fetchUnwrapped<T>(
  path: string,
  init: RequestInit,
  schema: z.ZodType<T>,
): Promise<T> {
  let res = await doFetch(path, init);
  if (res.status === 401) {
    const refreshed = await silentRefreshOnce();
    if (refreshed) {
      res = await doFetch(path, init);
    }
  }

  // 204 No Content：不应在本路径出现（仅 GET 用 fetchUnwrapped），
  // 走到此处说明 OAS 与实际响应不一致；按 schema 校验失败处理
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const parsed = ErrorEnvelopeSchema.safeParse(body);
    if (parsed.success) {
      throw new ProgressApiError(
        res.status,
        parsed.data.error.code,
        parsed.data.error.message,
        parsed.data.error.details,
      );
    }
    throw new ProgressApiError(
      res.status,
      'unknown',
      `Request failed with status ${res.status}`,
      body,
    );
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ProgressApiError(
      res.status,
      'schema_drift',
      'Response schema mismatch',
      result.error.issues,
    );
  }
  return result.data;
}

/**
 * PUT/POST/DELETE 路径：成功返回 204 不解析 body，失败抛 ProgressApiError。
 */
async function fetchUnwrappedVoid(path: string, init: RequestInit): Promise<void> {
  let res = await doFetch(path, init);
  if (res.status === 401) {
    const refreshed = await silentRefreshOnce();
    if (refreshed) {
      res = await doFetch(path, init);
    }
  }

  if (res.status === 204) return;

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const parsed = ErrorEnvelopeSchema.safeParse(body);
    if (parsed.success) {
      throw new ProgressApiError(
        res.status,
        parsed.data.error.code,
        parsed.data.error.message,
        parsed.data.error.details,
      );
    }
    throw new ProgressApiError(
      res.status,
      'unknown',
      `Request failed with status ${res.status}`,
      body,
    );
  }

  // 2xx 但不是 204：契约异常（PUT 应返回 204）；按 schema_drift 抛出避免静默
  throw new ProgressApiError(
    res.status,
    'schema_drift',
    `Expected 204 No Content, got ${res.status}`,
    body,
  );
}
