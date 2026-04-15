/**
 * @file test/terminalStore.test.ts - terminalStore 单元测试
 * @description 测试 PTY 状态管理：per-project sessions map 操作是否正确更新 store 状态。
 *              使用 vitest + mock invoke 模拟 Tauri Commands 返回值。
 * @author Atlas.oi
 * @date 2026-04-15
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useTerminalStore } from '../features/terminal/terminalStore';
import { DEFAULT_TERMINAL_SETTINGS, useSettingsStore } from '../shared/stores/settingsStore';

describe('per-project PTY sessions', () => {
  beforeEach(() => {
    // 使用自定义 shell，避免 spawnForProject 先 invoke get_default_shell_cmd 消耗 mock
    useSettingsStore.setState({
      appView: 'main',
      terminal: { ...DEFAULT_TERMINAL_SETTINGS, useSystemShell: false, customShellPath: '/bin/zsh' },
    });
    useTerminalStore.setState({
      sessions: {},
      activeProjectPath: null,
    });
    vi.clearAllMocks();
  });

  it('spawnForProject 在 sessions 中为项目创建条目', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      pty_id: 'pty-123',
      ws_port: 9001,
      ws_token: 'tok-abc',
    });

    await useTerminalStore.getState().spawnForProject('/proj-a', '/proj-a');

    const sessions = useTerminalStore.getState().sessions;
    expect(sessions['/proj-a']).toBeDefined();
    expect(sessions['/proj-a']!.ptyId).toBe('pty-123');
    expect(sessions['/proj-a']!.wsPort).toBe(9001);
  });

  it('spawnForProject 不 kill 其他项目的 PTY', async () => {
    useTerminalStore.setState({
      sessions: {
        '/proj-b': { ptyId: 'pty-b', wsPort: 9002, wsToken: 'tok-b', connected: true },
      },
      activeProjectPath: '/proj-b',
    });

    vi.mocked(invoke).mockResolvedValueOnce({
      pty_id: 'pty-a',
      ws_port: 9001,
      ws_token: 'tok-a',
    });

    await useTerminalStore.getState().spawnForProject('/proj-a', '/proj-a');

    const killCalls = vi.mocked(invoke).mock.calls.filter(c => c[0] === 'kill_pty_cmd');
    expect(killCalls).toHaveLength(0);

    const sessions = useTerminalStore.getState().sessions;
    expect(sessions['/proj-a']).toBeDefined();
    expect(sessions['/proj-b']).toBeDefined();
  });

  it('setConnected 只更新指定项目的 connected 状态', () => {
    useTerminalStore.setState({
      sessions: {
        '/proj-a': { ptyId: 'pty-a', wsPort: 9001, wsToken: 'tok-a', connected: false },
        '/proj-b': { ptyId: 'pty-b', wsPort: 9002, wsToken: 'tok-b', connected: false },
      },
    });

    useTerminalStore.getState().setConnected('/proj-a', true);

    const sessions = useTerminalStore.getState().sessions;
    expect(sessions['/proj-a']!.connected).toBe(true);
    expect(sessions['/proj-b']!.connected).toBe(false);
  });
});
