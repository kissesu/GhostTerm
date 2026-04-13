/**
 * @file test/terminalStore.test.ts - terminalStore 单元测试
 * @description 测试 PTY 状态管理：spawn/kill/reconnect/resize 操作是否正确更新 store 状态。
 *              使用 vitest + mock invoke 模拟 Tauri Commands 返回值。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useTerminalStore } from '../features/terminal/terminalStore';

// invoke 已在 setup.ts 中 mock
const mockInvoke = vi.mocked(invoke);

// 模拟 spawn_pty_cmd 的返回值
const MOCK_PTY_INFO = {
  pty_id: 'abcd1234efgh5678',
  ws_port: 54321,
  ws_token: 'a'.repeat(64),
};

// 模拟 reconnect_pty_cmd 的返回值（新 token）
const MOCK_RECONNECT_INFO = {
  pty_id: 'abcd1234efgh5678',
  ws_port: 54321,
  ws_token: 'b'.repeat(64),
};

describe('terminalStore', () => {
  // 每个测试前重置 store 到初始状态
  beforeEach(() => {
    useTerminalStore.setState({
      ptyId: null,
      wsPort: null,
      wsToken: null,
      connected: false,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('初始状态', () => {
    it('应有正确的初始值', () => {
      const state = useTerminalStore.getState();
      expect(state.ptyId).toBeNull();
      expect(state.wsPort).toBeNull();
      expect(state.wsToken).toBeNull();
      expect(state.connected).toBe(false);
    });
  });

  describe('spawn', () => {
    it('spawn 成功后应更新 ptyId/wsPort/wsToken', async () => {
      mockInvoke.mockResolvedValueOnce(MOCK_PTY_INFO);

      await useTerminalStore.getState().spawn('/tmp');

      const state = useTerminalStore.getState();
      expect(state.ptyId).toBe(MOCK_PTY_INFO.pty_id);
      expect(state.wsPort).toBe(MOCK_PTY_INFO.ws_port);
      expect(state.wsToken).toBe(MOCK_PTY_INFO.ws_token);
    });

    it('spawn 后 connected 应为 false（WebSocket 尚未建立）', async () => {
      mockInvoke.mockResolvedValueOnce(MOCK_PTY_INFO);

      await useTerminalStore.getState().spawn('/tmp');

      expect(useTerminalStore.getState().connected).toBe(false);
    });

    it('spawn 应调用正确的 Tauri Command', async () => {
      mockInvoke.mockResolvedValueOnce(MOCK_PTY_INFO);

      await useTerminalStore.getState().spawn('/home/user');

      expect(mockInvoke).toHaveBeenCalledWith('spawn_pty_cmd', {
        shell: '/bin/zsh',
        cwd: '/home/user',
      });
    });

    it('spawn 失败应抛出错误', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('PTY 创建失败'));

      await expect(useTerminalStore.getState().spawn('/tmp')).rejects.toThrow();
    });
  });

  describe('kill', () => {
    it('kill 后应重置所有状态为 null', async () => {
      // 先 spawn
      mockInvoke.mockResolvedValueOnce(MOCK_PTY_INFO);
      await useTerminalStore.getState().spawn('/tmp');

      // 再 kill
      mockInvoke.mockResolvedValueOnce(undefined);
      await useTerminalStore.getState().kill();

      const state = useTerminalStore.getState();
      expect(state.ptyId).toBeNull();
      expect(state.wsPort).toBeNull();
      expect(state.wsToken).toBeNull();
      expect(state.connected).toBe(false);
    });

    it('无 ptyId 时 kill 应提前返回（不调用 invoke）', async () => {
      await useTerminalStore.getState().kill();
      expect(mockInvoke).not.toHaveBeenCalled();
    });
  });

  describe('reconnect', () => {
    it('reconnect 应更新 wsToken（新 token）', async () => {
      // 先 spawn
      mockInvoke.mockResolvedValueOnce(MOCK_PTY_INFO);
      await useTerminalStore.getState().spawn('/tmp');

      const oldToken = useTerminalStore.getState().wsToken;

      // reconnect
      mockInvoke.mockResolvedValueOnce(MOCK_RECONNECT_INFO);
      await useTerminalStore.getState().reconnect();

      const newToken = useTerminalStore.getState().wsToken;
      expect(newToken).toBe(MOCK_RECONNECT_INFO.ws_token);
      expect(newToken).not.toBe(oldToken);
    });

    it('reconnect 后 connected 应重置为 false', async () => {
      // spawn + 手动设置 connected = true
      mockInvoke.mockResolvedValueOnce(MOCK_PTY_INFO);
      await useTerminalStore.getState().spawn('/tmp');
      useTerminalStore.getState().setConnected(true);

      // reconnect
      mockInvoke.mockResolvedValueOnce(MOCK_RECONNECT_INFO);
      await useTerminalStore.getState().reconnect();

      expect(useTerminalStore.getState().connected).toBe(false);
    });

    it('无 ptyId 时 reconnect 应提前返回', async () => {
      await useTerminalStore.getState().reconnect();
      expect(mockInvoke).not.toHaveBeenCalled();
    });
  });

  describe('resize', () => {
    it('resize 应调用 resize_pty_cmd 并传入正确参数', async () => {
      // 先 spawn
      mockInvoke.mockResolvedValueOnce(MOCK_PTY_INFO);
      await useTerminalStore.getState().spawn('/tmp');

      // resize
      mockInvoke.mockResolvedValueOnce(undefined);
      await useTerminalStore.getState().resize(120, 40);

      expect(mockInvoke).toHaveBeenLastCalledWith('resize_pty_cmd', {
        ptyId: MOCK_PTY_INFO.pty_id,
        cols: 120,
        rows: 40,
      });
    });

    it('无 ptyId 时 resize 应提前返回', async () => {
      await useTerminalStore.getState().resize(80, 24);
      expect(mockInvoke).not.toHaveBeenCalled();
    });
  });

  describe('setConnected', () => {
    it('setConnected(true) 应更新 connected 状态', () => {
      useTerminalStore.getState().setConnected(true);
      expect(useTerminalStore.getState().connected).toBe(true);
    });

    it('setConnected(false) 应更新 connected 状态', () => {
      useTerminalStore.setState({ connected: true });
      useTerminalStore.getState().setConnected(false);
      expect(useTerminalStore.getState().connected).toBe(false);
    });
  });
});
