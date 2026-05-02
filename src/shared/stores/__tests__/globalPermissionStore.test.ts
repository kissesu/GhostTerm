/**
 * @file globalPermissionStore.test.ts
 * @description globalPermissionStore Task 9 行为验证：
 *               - fetch() 命中 /api/me/effective-permissions 后回填状态
 *               - has() 三档通配（精确 / r:a:* / r:*:* / *:*）
 *               - super_admin 永真
 *               - hasAny() 任一命中即真
 *               - reset() / clear() 隔离行为
 *               - error 路径不抛异常但置 error+initialized
 *
 * @author Atlas.oi
 * @date 2026-05-02
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================
// 依赖 mock：
//   - getAccessToken：从 globalAuthStore 拿 token；测试给固定值
//   - silentRefreshOnce：401 单飞 refresh；本测试默认成功
//   - getBaseUrl：API base；测试给固定值
//   - global fetch：本测试核心被测，逐用例 mockResolvedValue
// ============================================
vi.mock('../globalAuthStore', () => ({
  getAccessToken: vi.fn(() => 'test_access_token'),
}));

vi.mock('../../../features/progress/api/client', () => ({
  getBaseUrl: vi.fn(() => 'http://test'),
  silentRefreshOnce: vi.fn(async () => true),
  ProgressApiError: class ProgressApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
      this.name = 'ProgressApiError';
    }
  },
}));

import { useGlobalPermissionStore } from '../globalPermissionStore';
import { silentRefreshOnce } from '../../../features/progress/api/client';

// 工具：构造一个 fetch Response 双状态体（OK + JSON / Err + JSON）
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  // 每个用例从干净 store 起步，避免相互污染
  useGlobalPermissionStore.getState().reset();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('globalPermissionStore.fetch', () => {
  it('成功响应回填 permissions + superAdmin + initialized', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse(200, {
        permissions: ['nav:view:work', 'nav:view:progress'],
        superAdmin: false,
      }),
    );

    await useGlobalPermissionStore.getState().fetch();

    const s = useGlobalPermissionStore.getState();
    expect(s.permissions.has('nav:view:work')).toBe(true);
    expect(s.permissions.has('nav:view:progress')).toBe(true);
    expect(s.isSuperAdmin).toBe(false);
    expect(s.initialized).toBe(true);
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
  });

  it('superAdmin=true 时置位 isSuperAdmin（独立于哨兵 *:*）', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse(200, { permissions: ['*:*'], superAdmin: true }),
    );

    await useGlobalPermissionStore.getState().fetch();

    expect(useGlobalPermissionStore.getState().isSuperAdmin).toBe(true);
    // has() 任意码必真
    expect(useGlobalPermissionStore.getState().has('whatever:anything:any')).toBe(true);
  });

  it('401 触发 silentRefresh + 重试一次后成功', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'unauthorized', message: 'expired' } }))
      .mockResolvedValueOnce(
        jsonResponse(200, { permissions: ['nav:view:work'], superAdmin: false }),
      );

    await useGlobalPermissionStore.getState().fetch();

    expect(silentRefreshOnce).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(useGlobalPermissionStore.getState().permissions.has('nav:view:work')).toBe(true);
    expect(useGlobalPermissionStore.getState().error).toBeNull();
  });

  it('500 错误响应设 error 字段而不抛（initialized=true 让 UI 走 fallback）', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse(500, { error: { code: 'internal', message: 'boom' } }),
    );

    await useGlobalPermissionStore.getState().fetch();

    const s = useGlobalPermissionStore.getState();
    expect(s.loading).toBe(false);
    expect(s.error).toContain('internal');
    expect(s.initialized).toBe(true);
    expect(s.permissions.size).toBe(0);
  });

  it('schema 不匹配时设 schema_drift error', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse(200, { wrong: 'shape' }),
    );

    await useGlobalPermissionStore.getState().fetch();

    // ProgressApiError.message 来自构造函数的 message 参数；code 字段未编入字符串
    expect(useGlobalPermissionStore.getState().error).toContain('schema mismatch');
    expect(useGlobalPermissionStore.getState().initialized).toBe(true);
  });
});

describe('globalPermissionStore.has 三档通配', () => {
  it('精确匹配 3 段权限码', () => {
    useGlobalPermissionStore.getState().hydrate(['nav:view:work']);
    expect(useGlobalPermissionStore.getState().has('nav:view:work')).toBe(true);
    expect(useGlobalPermissionStore.getState().has('nav:view:atlas')).toBe(false);
  });

  it('resource:action:* 通配命中同 ra 任意 scope', () => {
    useGlobalPermissionStore.getState().hydrate(['progress:project:*']);
    expect(useGlobalPermissionStore.getState().has('progress:project:list')).toBe(true);
    expect(useGlobalPermissionStore.getState().has('progress:project:create')).toBe(true);
    expect(useGlobalPermissionStore.getState().has('progress:event:create')).toBe(false);
  });

  it('resource:*:* 通配命中同 resource 任意 action/scope', () => {
    useGlobalPermissionStore.getState().hydrate(['progress:*:*']);
    expect(useGlobalPermissionStore.getState().has('progress:project:list')).toBe(true);
    expect(useGlobalPermissionStore.getState().has('progress:event:create')).toBe(true);
    expect(useGlobalPermissionStore.getState().has('atlas:user:list')).toBe(false);
  });

  it('*:* 哨兵让 super_admin 任意 perm 通过（兼容历史 hydrateFromMe 路径）', () => {
    useGlobalPermissionStore.getState().hydrate(['*:*']);
    expect(useGlobalPermissionStore.getState().has('any:thing:scope')).toBe(true);
    expect(useGlobalPermissionStore.getState().has('two:segment')).toBe(true);
  });

  it('isSuperAdmin flag 让 has() 任意码永真', () => {
    useGlobalPermissionStore.setState({ isSuperAdmin: true, permissions: new Set() });
    expect(useGlobalPermissionStore.getState().has('any:thing:scope')).toBe(true);
  });

  it('2 段历史码：r:* 通配（progressPermissionStore 兼容）', () => {
    useGlobalPermissionStore.getState().hydrate(['event:*']);
    expect(useGlobalPermissionStore.getState().has('event:E1')).toBe(true);
    expect(useGlobalPermissionStore.getState().has('project:read')).toBe(false);
  });

  it('hasAny 任一命中返回 true', () => {
    useGlobalPermissionStore.getState().hydrate(['nav:view:progress']);
    expect(
      useGlobalPermissionStore.getState().hasAny('nav:view:work', 'nav:view:progress'),
    ).toBe(true);
    expect(
      useGlobalPermissionStore.getState().hasAny('nav:view:work', 'nav:view:atlas'),
    ).toBe(false);
  });
});

describe('globalPermissionStore.reset / clear', () => {
  it('reset 清空全部状态（含 isSuperAdmin / initialized）', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse(200, { permissions: ['nav:view:work'], superAdmin: true }),
    );
    await useGlobalPermissionStore.getState().fetch();
    expect(useGlobalPermissionStore.getState().initialized).toBe(true);

    useGlobalPermissionStore.getState().reset();
    const s = useGlobalPermissionStore.getState();
    expect(s.permissions.size).toBe(0);
    expect(s.isSuperAdmin).toBe(false);
    expect(s.initialized).toBe(false);
    expect(s.error).toBeNull();
  });

  it('clear 只清码集合 + isSuperAdmin（兼容 globalAuthStore.logout 钩子）', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse(200, { permissions: ['nav:view:work'], superAdmin: true }),
    );
    await useGlobalPermissionStore.getState().fetch();

    useGlobalPermissionStore.getState().clear();
    const s = useGlobalPermissionStore.getState();
    expect(s.permissions.size).toBe(0);
    expect(s.isSuperAdmin).toBe(false);
    // initialized 保留 true 让 AppLayout 不会重复 fetch
    expect(s.initialized).toBe(true);
  });
});

describe('globalPermissionStore.hydrateFromMe（兼容 globalAuthStore.login 路径）', () => {
  it('从 user.permissions 数组回填', () => {
    useGlobalPermissionStore.getState().hydrateFromMe({
      permissions: ['project:read', 'event:E1'],
    } as { permissions: string[] });
    expect(useGlobalPermissionStore.getState().has('project:read')).toBe(true);
    expect(useGlobalPermissionStore.getState().has('event:E1')).toBe(true);
  });
});
