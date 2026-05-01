/**
 * @file globalAuthStore.test.ts
 * @description globalAuthStore Task 34 联动验证：
 *              登录成功后 progressPermissionStore.has() 对登录返回的 perms 为 true；
 *              登出后 progressPermissionStore.has() 全为 false。
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ============================================
// apiFetch 全局 mock — 防止真实网络请求
// ============================================
vi.mock('../../../features/progress/api/client', () => ({
  apiFetch: vi.fn(),
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

// globalPermissionStore mock — 避免依赖 me schema 逻辑
vi.mock('../globalPermissionStore', () => ({
  useGlobalPermissionStore: {
    getState: () => ({
      hydrateFromMe: vi.fn(),
      clear: vi.fn(),
    }),
  },
}));

import { useGlobalAuthStore } from '../globalAuthStore';
import { useProgressPermissionStore } from '../../../features/progress/stores/progressPermissionStore';
import { apiFetch } from '../../../features/progress/api/client';

// ============================================
// 测试前把两个 store 都清空，保证隔离
// ============================================
beforeEach(() => {
  vi.resetAllMocks();
  useGlobalAuthStore.setState({
    accessToken: null,
    refreshToken: null,
    user: null,
    loading: false,
    error: null,
  });
  useProgressPermissionStore.getState().clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('globalAuthStore → progressPermissionStore 联动 (Task 34)', () => {
  it('登录成功后 progressPermissionStore.has() 对 me 返回的权限为 true', async () => {
    const mockLoginResponse = {
      accessToken: 'at_abc',
      refreshToken: 'rt_abc',
      user: { id: 1, username: 'admin', displayName: 'Admin', roleId: 1, isActive: true, createdAt: '2026-01-01T00:00:00Z', permissions: [] },
    };
    const mockMeResponse = {
      id: 1,
      username: 'admin',
      displayName: 'Admin',
      roleId: 1,
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      // me 返回完整权限列表
      permissions: ['project:read', 'event:E1', 'event:E7'],
    };

    // 第一次 apiFetch → login；第二次 apiFetch → me
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(mockLoginResponse)
      .mockResolvedValueOnce(mockMeResponse);

    await useGlobalAuthStore.getState().login('admin', 'admin123');

    // me.permissions 里的每个权限都应在 progressPermissionStore 里
    expect(useProgressPermissionStore.getState().has('project:read')).toBe(true);
    expect(useProgressPermissionStore.getState().has('event:E1')).toBe(true);
    expect(useProgressPermissionStore.getState().has('event:E7')).toBe(true);
    // 未在权限列表里的权限应为 false
    expect(useProgressPermissionStore.getState().has('event:E12')).toBe(false);
  });

  it('登出后 progressPermissionStore.has() 全为 false', async () => {
    // 先手动设置一些权限，模拟已登录状态
    useProgressPermissionStore.getState().set(['project:read', 'event:E1']);
    expect(useProgressPermissionStore.getState().has('event:E1')).toBe(true);

    // apiFetch 模拟 logout 204 成功（z.void() 解析为 undefined）
    vi.mocked(apiFetch).mockResolvedValueOnce(undefined);

    await useGlobalAuthStore.getState().logout();

    expect(useProgressPermissionStore.getState().has('project:read')).toBe(false);
    expect(useProgressPermissionStore.getState().has('event:E1')).toBe(false);
  });

  it('登出即使后端失败也清空 progressPermissionStore', async () => {
    useProgressPermissionStore.getState().set(['event:E7']);

    // logout 后端失败（catch 内静默继续）
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('network error'));

    await useGlobalAuthStore.getState().logout();

    expect(useProgressPermissionStore.getState().has('event:E7')).toBe(false);
  });
});
