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
import { apiFetch, ProgressApiError } from '../../../features/progress/api/client';
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
    // GlitchTip user scope 同步 cmd —— 测试环境 Sentry 未 init，仅吞调用避免 unhandled noise
    if (cmd === 'set_sentry_user_cmd' || cmd === 'clear_sentry_user_cmd') {
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

describe('会话凭证持久化', () => {
  const loginData = {
    user: { id: 1, username: 'atlas', roleId: 1 },
    accessToken: '初始访问令牌', refreshToken: '初始刷新令牌',
  };
  const rotated = { accessToken: '轮换访问令牌', refreshToken: '轮换刷新令牌' };

  it('取消保持登录后清除旧凭证，轮换令牌也只留在当前会话', async () => {
    mockKeychainStore.refresh_token = 'previous';
    vi.mocked(apiFetch).mockResolvedValueOnce(loginData)
      .mockResolvedValueOnce(null).mockResolvedValueOnce(rotated);
    await useGlobalAuthStore.getState().login('atlas', 'test', false);
    expect(mockKeychainStore.refresh_token).toBeUndefined();
    await useGlobalAuthStore.getState().refresh();
    expect(mockKeychainStore.refresh_token).toBeUndefined();
    expect(useGlobalAuthStore.getState().refreshToken).toBe(rotated.refreshToken);
  });

  it('重新启动后恢复已保存的令牌，断网保留它，重试成功后保存新令牌', async () => {
    mockKeychainStore.refresh_token = loginData.refreshToken;
    useGlobalAuthStore.setState({ hydrating: true });
    await useGlobalAuthStore.getState().hydrate();
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('离线')).mockResolvedValueOnce(rotated);
    await expect(useGlobalAuthStore.getState().refresh()).rejects.toThrow('离线');
    expect(mockKeychainStore.refresh_token).toBe(loginData.refreshToken);
    await useGlobalAuthStore.getState().refresh();
    expect(mockKeychainStore.refresh_token).toBe(rotated.refreshToken);
  });

  it('服务端明确拒绝刷新令牌后清除本机凭证', async () => {
    mockKeychainStore.refresh_token = loginData.refreshToken;
    useGlobalAuthStore.setState({ hydrating: true });
    await useGlobalAuthStore.getState().hydrate();
    vi.mocked(apiFetch).mockRejectedValueOnce(new ProgressApiError(401, 'unauthorized', '已失效'));
    await expect(useGlobalAuthStore.getState().refresh()).rejects.toThrow('已失效');
    expect(mockKeychainStore.refresh_token).toBeUndefined();
    expect(useGlobalAuthStore.getState().refreshToken).toBeNull();
  });
});
