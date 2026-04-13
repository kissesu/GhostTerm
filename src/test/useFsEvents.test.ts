/**
 * @file test/useFsEvents.test.ts
 * @description useFsEvents Hook 单元测试 - 验证 Tauri 事件监听注册和卸载时取消订阅行为
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { listen } from '@tauri-apps/api/event';
import { useFsEvents } from '../shared/hooks/useFsEvents';
import type { FsEvent } from '../shared/types';

// setup.ts 已全局 mock @tauri-apps/api/event，
// 这里获取 mocked 版本以进行断言
const mockListen = vi.mocked(listen);

describe('useFsEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // 每次测试前重置 listen 的默认返回值：返回 unlisten 函数
    mockListen.mockResolvedValue(vi.fn());
  });

  it('挂载时应调用 listen("fs:event")', async () => {
    const onFsEvent = vi.fn();

    renderHook(() => useFsEvents(onFsEvent));

    // 等待 useEffect 中的异步 listen 调用完成
    await vi.waitFor(() => {
      expect(mockListen).toHaveBeenCalledWith('fs:event', expect.any(Function));
    });
  });

  it('收到事件时应调用 onFsEvent 回调并传递 payload', async () => {
    const onFsEvent = vi.fn();

    // 设置 listen mock：捕获注册的回调，以便手动触发事件
    let capturedCallback: ((tauriEvent: { payload: FsEvent }) => void) | null = null;
    mockListen.mockImplementation(async (_event, callback) => {
      capturedCallback = callback as (tauriEvent: { payload: FsEvent }) => void;
      return vi.fn();
    });

    renderHook(() => useFsEvents(onFsEvent));

    // 等待 listen 注册完成
    await vi.waitFor(() => {
      expect(capturedCallback).not.toBeNull();
    });

    // 模拟 Tauri 触发 fs:event
    const testEvent: FsEvent = { type: 'modified', path: '/proj/src/main.ts' };
    capturedCallback!({ payload: testEvent });

    // 回调应被调用并传递 FsEvent payload
    expect(onFsEvent).toHaveBeenCalledTimes(1);
    expect(onFsEvent).toHaveBeenCalledWith(testEvent);
  });

  it('卸载时应调用 unlisten 取消订阅', async () => {
    const onFsEvent = vi.fn();
    const mockUnlisten = vi.fn();

    // listen 返回的 unlisten 函数
    mockListen.mockResolvedValue(mockUnlisten);

    const { unmount } = renderHook(() => useFsEvents(onFsEvent));

    // 等待 listen 完成，unlisten 被赋值
    await vi.waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    // 组件卸载
    unmount();

    // unlisten 应被调用
    expect(mockUnlisten).toHaveBeenCalled();
  });

  it('onFsEvent 变化时应重新注册监听器', async () => {
    const onFsEvent1 = vi.fn();
    const onFsEvent2 = vi.fn();
    const mockUnlisten = vi.fn();

    mockListen.mockResolvedValue(mockUnlisten);

    const { rerender } = renderHook(
      ({ handler }) => useFsEvents(handler),
      { initialProps: { handler: onFsEvent1 } }
    );

    // 等待首次注册
    await vi.waitFor(() => {
      expect(mockListen).toHaveBeenCalledTimes(1);
    });

    // 更换 handler（rerender with new props）
    rerender({ handler: onFsEvent2 });

    // 旧监听器应被取消，新监听器应被注册
    await vi.waitFor(() => {
      expect(mockListen).toHaveBeenCalledTimes(2);
    });
  });
});
