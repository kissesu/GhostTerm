/**
 * @file progressAuthStore.test.ts
 * @description Phase 2 auth store 单测：
 *              - login mocked apiFetch → store 写入 token + user，refreshToken 落 localStorage
 *              - login 失败 → store 清空 token + 写 error
 *              - refresh 成功 → 仅更新 accessToken
 *              - logout → 清空全部 + 删除 localStorage
 *              - getAccessToken / clearLocal helpers
 *
 *              不 mock 整个 fetch 网络，而是 mock 项目内的 apiFetch 模块 ——
 *              由于 store 依赖 client.ts 的 named export，vi.mock 必须先于 import 解析。
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================
// mock apiFetch（覆盖 client 的 named export）
// 注：vi.mock 必须 hoisted 到 import 之前；在 vitest 中 vi.mock 工厂会被自动 hoist
// ============================================
vi.mock('../../api/client', () => ({
  apiFetch: vi.fn(),
  ProgressApiError: class extends Error {
    public readonly status: number;
    public readonly code: string;
    public readonly details?: unknown;
    constructor(status: number, code: string, message: string, details?: unknown) {
      super(message);
      this.name = 'ProgressApiError';
      this.status = status;
      this.code = code;
      this.details = details;
    }
  },
  getBaseUrl: () => 'http://test',
}));

import { apiFetch, ProgressApiError } from '../../api/client';
import { getAccessToken, useProgressAuthStore } from '../progressAuthStore';

const mockedApiFetch = vi.mocked(apiFetch);

const SAMPLE_USER = {
  id: 1,
  email: 'alice@example.com',
  displayName: 'Alice',
  roleId: 2,
  isActive: true,
  createdAt: '2026-04-29T00:00:00Z',
  // Phase 3：UserSchema 含 permissions 字段（默认空数组）
  permissions: [] as string[],
};

beforeEach(() => {
  // 每个用例前重置 store + localStorage，避免状态串流
  useProgressAuthStore.setState({
    accessToken: null,
    refreshToken: null,
    user: null,
    loading: false,
    error: null,
  });
  globalThis.localStorage.clear();
  mockedApiFetch.mockReset();
});

// ============================================
// login: 成功路径
// ============================================
describe('progressAuthStore.login', () => {
  it('成功登录后写入 access/refresh/user 并把 refresh 落 localStorage', async () => {
    mockedApiFetch.mockResolvedValueOnce({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      user: SAMPLE_USER,
    });

    await useProgressAuthStore.getState().login('alice@example.com', 'password');

    const state = useProgressAuthStore.getState();
    expect(state.accessToken).toBe('access-1');
    expect(state.refreshToken).toBe('refresh-1');
    expect(state.user).toEqual(SAMPLE_USER);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(globalThis.localStorage.getItem('progress_refresh_token')).toBe('refresh-1');
  });

  it('登录失败时清空 token 并写 error', async () => {
    const apiErr = new ProgressApiError(401, 'unauthorized', '邮箱或密码错误');
    mockedApiFetch.mockRejectedValueOnce(apiErr);

    await expect(
      useProgressAuthStore.getState().login('bad@example.com', 'wrong'),
    ).rejects.toBe(apiErr);

    const state = useProgressAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.user).toBeNull();
    expect(state.error).toBe('邮箱或密码错误');
    expect(state.loading).toBe(false);
  });
});

// ============================================
// refresh: 仅更新 accessToken；失败清空 refresh
// ============================================
describe('progressAuthStore.refresh', () => {
  it('成功 refresh 后只更新 accessToken，refreshToken 不变', async () => {
    useProgressAuthStore.setState({ refreshToken: 'refresh-1', accessToken: 'old' });

    mockedApiFetch.mockResolvedValueOnce({ accessToken: 'access-2' });

    await useProgressAuthStore.getState().refresh();

    const state = useProgressAuthStore.getState();
    expect(state.accessToken).toBe('access-2');
    expect(state.refreshToken).toBe('refresh-1');
  });

  it('没有 refreshToken 时直接抛 ProgressApiError，不发请求', async () => {
    await expect(useProgressAuthStore.getState().refresh()).rejects.toBeInstanceOf(
      ProgressApiError,
    );
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });

  it('refresh 后端拒绝时清空全部 + 删 localStorage', async () => {
    useProgressAuthStore.setState({ refreshToken: 'refresh-1' });
    globalThis.localStorage.setItem('progress_refresh_token', 'refresh-1');

    mockedApiFetch.mockRejectedValueOnce(
      new ProgressApiError(401, 'unauthorized', 'refresh 已失效'),
    );

    await expect(useProgressAuthStore.getState().refresh()).rejects.toBeInstanceOf(
      ProgressApiError,
    );

    const state = useProgressAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.user).toBeNull();
    expect(globalThis.localStorage.getItem('progress_refresh_token')).toBeNull();
  });
});

// ============================================
// logout: 后端成功 / 失败都要清空本地
// ============================================
describe('progressAuthStore.logout', () => {
  it('logout 调用后清空 token + user + localStorage', async () => {
    useProgressAuthStore.setState({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      user: SAMPLE_USER,
    });
    globalThis.localStorage.setItem('progress_refresh_token', 'refresh-1');

    mockedApiFetch.mockResolvedValueOnce(undefined);

    await useProgressAuthStore.getState().logout();

    const state = useProgressAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.user).toBeNull();
    expect(globalThis.localStorage.getItem('progress_refresh_token')).toBeNull();
  });

  it('后端 logout 失败时仍清空本地（语义：用户要退出）', async () => {
    useProgressAuthStore.setState({ accessToken: 'expired', user: SAMPLE_USER });

    mockedApiFetch.mockRejectedValueOnce(
      new ProgressApiError(401, 'unauthorized', 'token 过期'),
    );

    await useProgressAuthStore.getState().logout();

    const state = useProgressAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.user).toBeNull();
  });
});

// ============================================
// loadMe: 已登录的情况下拉用户信息
// ============================================
describe('progressAuthStore.loadMe', () => {
  it('成功 loadMe 后 user 被填充', async () => {
    useProgressAuthStore.setState({ accessToken: 'access-1' });
    mockedApiFetch.mockResolvedValueOnce(SAMPLE_USER);

    await useProgressAuthStore.getState().loadMe();

    expect(useProgressAuthStore.getState().user).toEqual(SAMPLE_USER);
  });
});

// ============================================
// helpers
// ============================================
describe('progressAuthStore helpers', () => {
  it('getAccessToken 返回当前 store 的 accessToken', () => {
    expect(getAccessToken()).toBeNull();
    useProgressAuthStore.setState({ accessToken: 'token-x' });
    expect(getAccessToken()).toBe('token-x');
  });

  it('clearLocal 不调后端，直接清空 token + user', () => {
    useProgressAuthStore.setState({
      accessToken: 'a',
      refreshToken: 'r',
      user: SAMPLE_USER,
    });
    globalThis.localStorage.setItem('progress_refresh_token', 'r');

    useProgressAuthStore.getState().clearLocal();

    const state = useProgressAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.user).toBeNull();
    expect(globalThis.localStorage.getItem('progress_refresh_token')).toBeNull();
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });
});
