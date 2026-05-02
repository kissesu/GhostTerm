/**
 * @file atlasRolesStore.ts
 * @description Atlas 角色 + 权限矩阵 store。
 *
 *              数据结构：
 *                - roles：所有角色列表
 *                - permissions：所有权限定义
 *                - rolePermissions：Map<roleId, Set<permissionId>>
 *                  权限矩阵的本地视图，支持矩阵勾选切换
 *
 *              工作流：
 *                1. load()  并发拉 roles + permissions + 各 role 已绑定权限
 *                2. togglePermission(roleId, permId)  本地 toggle Set 中元素
 *                3. saveRolePermissions(roleId)       PATCH 当前 roleId 的全部 permissionIds
 *                4. resetRoleEdits(roleId)            从 rolePermissionsServer 复原
 *
 *              dirty 检测：rolePermissions vs rolePermissionsServer 的 Set diff
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { create } from 'zustand';

import {
  listPermissions,
  listRoles,
  getRolePermissions,
  updateRolePermissions,
  type Permission,
  type Role,
} from '../api/roles';

interface AtlasRolesState {
  roles: Role[];
  permissions: Permission[];
  /** 本地编辑中的权限矩阵：roleId → Set<permissionId> */
  rolePermissions: Map<number, Set<number>>;
  /** 服务端权威快照：用于 dirty 检测和 reset */
  rolePermissionsServer: Map<number, Set<number>>;
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  togglePermission: (roleId: number, permissionId: number) => void;
  isDirty: (roleId: number) => boolean;
  saveRolePermissions: (roleId: number) => Promise<void>;
  resetRoleEdits: (roleId: number) => void;
  clearError: () => void;
}

// 工具：复制 Set
function cloneSet<T>(s: Set<T>): Set<T> {
  return new Set(s);
}

// 工具：判断两个 Set 是否相等
function setEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

export const useAtlasRolesStore = create<AtlasRolesState>((set, get) => ({
  roles: [],
  permissions: [],
  rolePermissions: new Map(),
  rolePermissionsServer: new Map(),
  loading: false,
  error: null,

  async load() {
    set({ loading: true, error: null });
    try {
      // 第一步：并发拉 roles + permissions
      const [roles, permissions] = await Promise.all([listRoles(), listPermissions()]);

      // 第二步：并发拉每个 role 的权限绑定
      const entries = await Promise.all(
        roles.map(async (r) => {
          const perms = await getRolePermissions(r.id);
          return [r.id, new Set(perms.map((p) => p.id))] as const;
        }),
      );

      const rolePermissions = new Map<number, Set<number>>();
      const rolePermissionsServer = new Map<number, Set<number>>();
      for (const [roleId, permSet] of entries) {
        rolePermissions.set(roleId, cloneSet(permSet));
        rolePermissionsServer.set(roleId, cloneSet(permSet));
      }

      set({ roles, permissions, rolePermissions, rolePermissionsServer, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  },

  togglePermission(roleId, permissionId) {
    const current = get().rolePermissions.get(roleId);
    // 不存在的 roleId 不允许 toggle（保护测试边界）
    if (!current) return;
    const next = cloneSet(current);
    if (next.has(permissionId)) {
      next.delete(permissionId);
    } else {
      next.add(permissionId);
    }
    const map = new Map(get().rolePermissions);
    map.set(roleId, next);
    set({ rolePermissions: map });
  },

  isDirty(roleId) {
    const local = get().rolePermissions.get(roleId);
    const server = get().rolePermissionsServer.get(roleId);
    if (!local || !server) return false;
    return !setEqual(local, server);
  },

  async saveRolePermissions(roleId) {
    const local = get().rolePermissions.get(roleId);
    if (!local) {
      throw new Error(`atlas roles: role ${roleId} not found`);
    }
    const ids = Array.from(local);
    // Task 7：写入返回 204，本地无法直接拿到新权限列表；
    // 用 GET /api/roles/{id}/permissions 拉一次最新值刷快照（业务上等价于回写本地集合，
    // 但显式重拉能在并发场景下捕获其它管理员的中间写入）
    await updateRolePermissions(roleId, ids);
    const fresh = await getRolePermissions(roleId);
    const newSet = new Set<number>(fresh.map((p) => p.id));
    const localMap = new Map(get().rolePermissions);
    const serverMap = new Map(get().rolePermissionsServer);
    localMap.set(roleId, cloneSet(newSet));
    serverMap.set(roleId, cloneSet(newSet));
    set({ rolePermissions: localMap, rolePermissionsServer: serverMap });
  },

  resetRoleEdits(roleId) {
    const server = get().rolePermissionsServer.get(roleId);
    if (!server) return;
    const map = new Map(get().rolePermissions);
    map.set(roleId, cloneSet(server));
    set({ rolePermissions: map });
  },

  clearError() {
    set({ error: null });
  },
}));
