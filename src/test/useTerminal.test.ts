/**
 * @file test/useTerminal.test.ts - useTerminal hook 单元测试
 * @description 测试 WebSocket 连接生命周期：onopen 更新 connected 状态，
 *              onclose 触发 reconnect，WebSocket 实例正确创建。
 *              使用 vitest fake timers 控制重连延迟。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTerminal } from '../features/terminal/useTerminal';
import { useTerminalStore } from '../features/terminal/terminalStore';

// 模拟 WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  binaryType: string = 'blob';
  readyState: number = WebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close() {
    this.readyState = WebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code: 1000 });
    }
  }

  // 测试辅助方法：模拟连接建立
  triggerOpen() {
    this.readyState = WebSocket.OPEN;
    if (this.onopen) this.onopen();
  }

  // 测试辅助方法：模拟连接断开
  triggerClose(code = 1006) {
    this.readyState = WebSocket.CLOSED;
    if (this.onclose) this.onclose({ code });
  }
}

describe('useTerminal', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    // 替换全局 WebSocket
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.useFakeTimers();

    // 重置 store 状态
    useTerminalStore.setState({
      ptyId: 'test-pty-id',
      wsPort: 54321,
      wsToken: 'a'.repeat(64),
      connected: false,
    });

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('wsPort/wsToken 有值时应创建 WebSocket 连接', () => {
    renderHook(() => useTerminal());

    expect(MockWebSocket.instances.length).toBe(1);
    expect(MockWebSocket.instances[0].url).toBe(
      `ws://127.0.0.1:54321?token=${'a'.repeat(64)}`
    );
  });

  it('wsPort/wsToken 为 null 时不应创建 WebSocket', () => {
    useTerminalStore.setState({ wsPort: null, wsToken: null });

    renderHook(() => useTerminal());

    expect(MockWebSocket.instances.length).toBe(0);
  });

  it('WebSocket onopen 后应调用 setConnected(true)', async () => {
    renderHook(() => useTerminal());

    expect(MockWebSocket.instances.length).toBe(1);
    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.triggerOpen();
    });

    expect(useTerminalStore.getState().connected).toBe(true);
  });

  it('WebSocket onclose 后应调用 setConnected(false)', async () => {
    const { invoke: mockInvoke } = await import('@tauri-apps/api/core');
    vi.mocked(mockInvoke).mockResolvedValue({
      pty_id: 'test-pty-id',
      ws_port: 54321,
      ws_token: 'b'.repeat(64),
    });

    renderHook(() => useTerminal());

    const ws = MockWebSocket.instances[0];
    act(() => ws.triggerOpen());

    expect(useTerminalStore.getState().connected).toBe(true);

    act(() => ws.triggerClose());

    expect(useTerminalStore.getState().connected).toBe(false);
  });

  it('onclose 后应在 1s 延迟后触发 reconnect', async () => {
    const { invoke: mockInvoke } = await import('@tauri-apps/api/core');
    vi.mocked(mockInvoke).mockResolvedValue({
      pty_id: 'test-pty-id',
      ws_port: 54321,
      ws_token: 'b'.repeat(64),
    });

    renderHook(() => useTerminal());

    const ws = MockWebSocket.instances[0];
    act(() => ws.triggerClose());

    // 1s 前不应触发 reconnect
    expect(vi.mocked(mockInvoke)).not.toHaveBeenCalled();

    // 推进 1s 后应触发 reconnect（reconnect_pty_cmd）
    await act(async () => {
      vi.advanceTimersByTime(1000);
      // 等待 promise 解析
      await Promise.resolve();
    });

    expect(vi.mocked(mockInvoke)).toHaveBeenCalledWith('reconnect_pty_cmd', expect.any(Object));
  });

  it('wsToken 变化时应创建新的 WebSocket 连接', () => {
    const { rerender } = renderHook(() => useTerminal());

    // 初始连接
    expect(MockWebSocket.instances.length).toBe(1);

    // 更新 token（模拟 reconnect 后 token 变化）
    act(() => {
      useTerminalStore.setState({ wsToken: 'b'.repeat(64) });
    });
    rerender();

    // 应创建新的 WebSocket 连接
    expect(MockWebSocket.instances.length).toBe(2);
  });

  it('wsRef 应返回当前 WebSocket 实例', () => {
    const { result } = renderHook(() => useTerminal());

    // renderHook 执行后 wsRef 应指向创建的 WebSocket
    expect(result.current.wsRef.current).toBeInstanceOf(MockWebSocket);
  });
});
