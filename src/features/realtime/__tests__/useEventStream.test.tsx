/**
 * @file useEventStream.test.tsx
 * @description 验证 useEventStream 挂载时启动 SSE + listen 双 emit + visibilitychange 兜底
 * @author Atlas.oi
 * @date 2026-05-09
 */
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

const invokeMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const listenMock = vi.fn().mockResolvedValue(() => {});
vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, cb: (e: unknown) => void) => listenMock(event, cb),
}));

const reloadMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../reloadVisibleData', () => ({ reloadVisibleData: () => reloadMock() }));

vi.mock('../../../shared/stores/globalAuthStore', () => ({
  useGlobalAuthStore: { getState: () => ({ accessToken: 'test-token', user: { id: 1 } }) },
}));

vi.mock('../../progress/api/client', () => ({
  getBaseUrl: () => 'https://atlas.example/test',
}));

import { useEventStream } from '../useEventStream';

describe('useEventStream', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test('挂载时调 invoke subscribe_events_cmd 带 baseUrl/accessToken', async () => {
    renderHook(() => useEventStream());
    await new Promise((r) => setTimeout(r, 10));
    expect(invokeMock).toHaveBeenCalledWith(
      'subscribe_events_cmd',
      expect.objectContaining({
        baseUrl: 'https://atlas.example/test',
        accessToken: 'test-token',
      }),
    );
  });

  test('挂载后 listen app://event 与 app://need-reload', async () => {
    renderHook(() => useEventStream());
    await new Promise((r) => setTimeout(r, 10));
    const channels = listenMock.mock.calls.map((c) => c[0]);
    expect(channels).toContain('app://event');
    expect(channels).toContain('app://need-reload');
  });

  test('收到 need-reload 事件触发 reloadVisibleData', async () => {
    renderHook(() => useEventStream());
    await new Promise((r) => setTimeout(r, 10));
    const reloadCb = listenMock.mock.calls.find((c) => c[0] === 'app://need-reload')![1];
    reloadCb({ payload: undefined });
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  test('visibilitychange visible 触发 reloadVisibleData', async () => {
    renderHook(() => useEventStream());
    await new Promise((r) => setTimeout(r, 10));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(reloadMock).toHaveBeenCalled();
  });
});
