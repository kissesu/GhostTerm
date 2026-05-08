/**
 * @file globalAuthStore.test.ts
 * @description globalAuthStore Task 34 联动验证：
 *              登录成功后 progressPermissionStore.has() 对登录返回的 perms 为 true；
 *              登出后 progressPermissionStore.has() 全为 false。
 *
 *              finding #12 后：refreshToken 走 keychain IPC（set/get/delete_refresh_token_cmd），
 *              测试用 mockKeychainStore 模拟 keychain 状态；invoke 全局 mock 在 src/test/setup.ts。
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
import { invoke } from '@tauri-apps/api/core';

// ============================================
// keychain 模拟存储 —— 替代 localStorage
// finding #12：refreshToken 改走系统 keychain IPC，测试用内存 Record 模拟
// invoke 全局 mock 已在 src/test/setup.ts，这里按 cmd 名分发到该模拟存储
// ============================================
const mockKeychainStore: Record<string, string> = {};

function setupKeychainMock(): void {
  // invoke 的 InvokeArgs 类型联合较宽（含 number[]/Record/...），
  // 这里只关心 set_refresh_token_cmd 的 { token: string } 形态，按对象处理
  vi.mocked(invoke).mockImplementation(((cmd: string, args?: unknown) => {
    if (cmd === 'get_refresh_token_cmd') {
      return Promise.resolve(mockKeychainStore.refresh_token ?? null);
    }
    if (cmd === 'set_refresh_token_cmd') {
      const token = (args as { token?: string } | undefined)?.token ?? '';
      mockKeychainStore.refresh_token = String(token);
      return Promise.resolve();
    }
    if (cmd === 'delete_refresh_token_cmd') {
      delete mockKeychainStore.refresh_token;
      return Promise.resolve();
    }
    return Promise.reject(new Error(`unhandled invoke in test: ${cmd}`));
  }) as unknown as typeof invoke);
}

// ============================================
// 测试前把两个 store + keychain mock 都清空，保证隔离
// ============================================
beforeEach(() => {
  vi.resetAllMocks();
  Object.keys(mockKeychainStore).forEach((k) => delete mockKeychainStore[k]);
  setupKeychainMock();
  useGlobalAuthStore.setState({
    accessToken: null,
    refreshToken: null,
    user: null,
    loading: false,
    error: null,
    hydrating: false,
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
