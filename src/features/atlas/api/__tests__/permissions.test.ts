/**
 * @file permissions.test.ts
 * @description Atlas permissions API client 契约测试。
 *
 *              覆盖：
 *                1. listAllPermissions     —— DataEnvelope 包裹路径，校验 zod 解析
 *                2. updateRolePermissions  —— PUT 204，传参 permissionIds
 *                3. getMyEffectivePermissions —— 不带 envelope 的顶层 schema
 *                4. getUserPermissionOverrides —— 顶层 envelope.overrides 抽出
 *                5. updateUserPermissionOverrides —— PUT 204 + body 形状
 *                6. fetch 错误时抛 ProgressApiError（非 2xx → 解析 ErrorEnvelope）
 *
 * @author Atlas.oi
 * @date 2026-05-02
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  listAllPermissions,
  getRolePermissions,
  updateRolePermissions,
  getUserPermissionOverrides,
  updateUserPermissionOverrides,
  getMyEffectivePermissions,
} from '../permissions';
import { ProgressApiError } from '../../../progress/api/client';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('listAllPermissions', () => {
  it('解析 DataEnvelope 包裹的 Permission[]', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: 1, resource: 'project', action: 'read', scope: 'all', code: 'project:read:all' },
          { id: 2, resource: 'feedback', action: 'create', scope: 'all', code: 'feedback:create:all' },
        ],
      }),
    });
    vi.stubGlobal('fetch', fakeFetch);

    const res = await listAllPermissions();
    expect(res).toHaveLength(2);
    expect(res[0].code).toBe('project:read:all');
    const url = fakeFetch.mock.calls[0][0] as string;
    expect(url).toContain('/api/permissions');
  });
});

describe('getRolePermissions', () => {
  it('按 roleId 拼路径', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    });
    vi.stubGlobal('fetch', fakeFetch);

    await getRolePermissions(7);
    const url = fakeFetch.mock.calls[0][0] as string;
    expect(url).toContain('/api/roles/7/permissions');
  });
});

describe('updateRolePermissions', () => {
  it('PUT 204 + body 含 permissionIds 数组', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => null,
    });
    vi.stubGlobal('fetch', fakeFetch);

    await updateRolePermissions(2, [10, 11, 12]);
    const init = fakeFetch.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ permissionIds: [10, 11, 12] });
  });
});

describe('getMyEffectivePermissions', () => {
  it('解析顶层 EffectivePermissionsResponse（无 data 包裹）', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        permissions: ['project:read:all', 'feedback:create:all'],
        superAdmin: false,
      }),
    });
    vi.stubGlobal('fetch', fakeFetch);

    const res = await getMyEffectivePermissions();
    expect(res.permissions).toEqual(['project:read:all', 'feedback:create:all']);
    expect(res.superAdmin).toBe(false);
  });

  it('superAdmin=true 时 permissions=["*:*"]', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ permissions: ['*:*'], superAdmin: true }),
    });
    vi.stubGlobal('fetch', fakeFetch);

    const res = await getMyEffectivePermissions();
    expect(res.superAdmin).toBe(true);
    expect(res.permissions).toEqual(['*:*']);
  });
});

describe('getUserPermissionOverrides', () => {
  it('从 UserPermissionOverridesResponse.overrides 抽取数组返回', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        userId: 5,
        overrides: [
          { permissionId: 11, effect: 'grant' },
          { permissionId: 22, effect: 'deny' },
        ],
      }),
    });
    vi.stubGlobal('fetch', fakeFetch);

    const res = await getUserPermissionOverrides(5);
    expect(res).toHaveLength(2);
    expect(res[0]).toEqual({ permissionId: 11, effect: 'grant' });
    expect(res[1]).toEqual({ permissionId: 22, effect: 'deny' });
  });
});

describe('updateUserPermissionOverrides', () => {
  it('PUT 204 + body 含 overrides 数组', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => null,
    });
    vi.stubGlobal('fetch', fakeFetch);

    await updateUserPermissionOverrides(5, [
      { permissionId: 11, effect: 'grant' },
      { permissionId: 22, effect: 'deny' },
    ]);
    const init = fakeFetch.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('PUT');
    const body = JSON.parse(init.body as string);
    expect(body.overrides).toHaveLength(2);
    expect(body.overrides[0]).toEqual({ permissionId: 11, effect: 'grant' });
  });
});

describe('error envelope 翻译', () => {
  it('非 2xx 响应抛 ProgressApiError 携带 code+message', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        error: { code: 'permission_denied', message: '无权访问权限字典' },
      }),
    });
    vi.stubGlobal('fetch', fakeFetch);

    await expect(getMyEffectivePermissions()).rejects.toMatchObject({
      name: 'ProgressApiError',
      status: 403,
      code: 'permission_denied',
    });
  });

  it('schema 漂移抛 schema_drift', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      // 缺 superAdmin 字段
      json: async () => ({ permissions: ['project:read:all'] }),
    });
    vi.stubGlobal('fetch', fakeFetch);

    await expect(getMyEffectivePermissions()).rejects.toMatchObject({
      name: 'ProgressApiError',
      code: 'schema_drift',
    });
  });

  it('PUT 非 204 时抛 schema_drift（防契约漂移）', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fakeFetch);

    await expect(
      updateUserPermissionOverrides(5, [{ permissionId: 11, effect: 'grant' }]),
    ).rejects.toBeInstanceOf(ProgressApiError);
  });
});
