/**
 * @file atlasRolesStore.test.ts
 * @description atlasRolesStore 单测：
 *               - load 同步 roles+permissions+rolePermissions
 *               - togglePermission 本地切换
 *               - isDirty 检测本地 vs 服务端 diff
 *               - saveRolePermissions 调用 API + 同步快照
 *               - resetRoleEdits 复原服务端
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/roles', () => ({
  listRoles: vi.fn(),
  listPermissions: vi.fn(),
  getRolePermissions: vi.fn(),
  updateRolePermissions: vi.fn(),
}));

import {
  listRoles,
  listPermissions,
  getRolePermissions,
  updateRolePermissions,
} from '../../api/roles';
import { useAtlasRolesStore } from '../atlasRolesStore';

const mockedListRoles = vi.mocked(listRoles);
const mockedListPerms = vi.mocked(listPermissions);
const mockedGetRolePerms = vi.mocked(getRolePermissions);
const mockedUpdate = vi.mocked(updateRolePermissions);

const ROLE_A = { id: 2, name: 'developer', isSystem: true, createdAt: '2026-04-29T00:00:00Z' };
const ROLE_B = { id: 3, name: 'pm', isSystem: false, createdAt: '2026-04-29T00:00:00Z' };
const PERM_1 = { id: 10, resource: 'project', action: 'read', scope: 'all' };
const PERM_2 = { id: 11, resource: 'project', action: 'create', scope: 'all' };

beforeEach(() => {
  useAtlasRolesStore.setState({
    roles: [],
    permissions: [],
    rolePermissions: new Map(),
    rolePermissionsServer: new Map(),
    loading: false,
    error: null,
  });
  mockedListRoles.mockReset();
  mockedListPerms.mockReset();
  mockedGetRolePerms.mockReset();
  mockedUpdate.mockReset();
});

describe('atlasRolesStore.load', () => {
  it('并发拉取后填充 roles/permissions/rolePermissions 双快照', async () => {
    mockedListRoles.mockResolvedValueOnce([ROLE_A, ROLE_B]);
    mockedListPerms.mockResolvedValueOnce([PERM_1, PERM_2]);
    mockedGetRolePerms.mockImplementation(async (roleId) => {
      if (roleId === 2) return [PERM_1];
      if (roleId === 3) return [PERM_1, PERM_2];
      return [];
    });

    await useAtlasRolesStore.getState().load();
    const s = useAtlasRolesStore.getState();
    expect(s.roles).toHaveLength(2);
    expect(s.permissions).toHaveLength(2);
    expect(Array.from(s.rolePermissions.get(2)!)).toEqual([10]);
    expect(Array.from(s.rolePermissions.get(3)!).sort()).toEqual([10, 11]);
    // 服务端快照与本地一致
    expect(s.rolePermissionsServer.get(2)).toEqual(s.rolePermissions.get(2));
  });
});

describe('atlasRolesStore.togglePermission + isDirty', () => {
  it('切换后 isDirty=true；再切回 isDirty=false', () => {
    useAtlasRolesStore.setState({
      rolePermissions: new Map([[2, new Set([10])]]),
      rolePermissionsServer: new Map([[2, new Set([10])]]),
    });
    expect(useAtlasRolesStore.getState().isDirty(2)).toBe(false);

    useAtlasRolesStore.getState().togglePermission(2, 11);
    expect(useAtlasRolesStore.getState().isDirty(2)).toBe(true);

    useAtlasRolesStore.getState().togglePermission(2, 11);
    expect(useAtlasRolesStore.getState().isDirty(2)).toBe(false);
  });

  it('toggle 不存在的 roleId 是 no-op', () => {
    useAtlasRolesStore.getState().togglePermission(999, 10);
    expect(useAtlasRolesStore.getState().rolePermissions.size).toBe(0);
  });
});

describe('atlasRolesStore.saveRolePermissions', () => {
  it('保存后用服务端返回值同步两份快照', async () => {
    useAtlasRolesStore.setState({
      rolePermissions: new Map([[2, new Set([10, 11])]]),
      rolePermissionsServer: new Map([[2, new Set([10])]]),
    });
    mockedUpdate.mockResolvedValueOnce([PERM_1, PERM_2]);

    await useAtlasRolesStore.getState().saveRolePermissions(2);

    const s = useAtlasRolesStore.getState();
    expect(Array.from(s.rolePermissions.get(2)!).sort()).toEqual([10, 11]);
    expect(Array.from(s.rolePermissionsServer.get(2)!).sort()).toEqual([10, 11]);
    expect(s.isDirty(2)).toBe(false);
  });

  it('未知 roleId 抛错', async () => {
    await expect(
      useAtlasRolesStore.getState().saveRolePermissions(999),
    ).rejects.toThrow();
  });
});

describe('atlasRolesStore.resetRoleEdits', () => {
  it('从服务端快照复原本地编辑', () => {
    useAtlasRolesStore.setState({
      rolePermissions: new Map([[2, new Set([10, 11])]]),
      rolePermissionsServer: new Map([[2, new Set([10])]]),
    });
    useAtlasRolesStore.getState().resetRoleEdits(2);
    expect(Array.from(useAtlasRolesStore.getState().rolePermissions.get(2)!)).toEqual([10]);
  });
});
