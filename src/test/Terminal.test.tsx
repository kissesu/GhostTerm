/**
 * @file test/Terminal.test.tsx - Terminal 组件单元测试
 * @description 测试 Terminal 组件挂载行为：
 *              - xterm.js 实例创建和 DOM 挂载
 *              - WebGL addon 加载（失败时降级）
 *              - AttachAddon 在 WebSocket 连接后加载
 *              - 错误 UI 显示和重试按钮
 *              - per-project session 状态订阅（Task 10 补全）
 * @author Atlas.oi
 * @date 2026-04-15
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ============================================
// vi.hoisted：在模块 mock 之前定义 spy 函数
// vi.mock 工厂函数会被提升到文件顶部，因此 mock 实现中引用的变量
// 必须通过 vi.hoisted 来定义，否则会出现 TDZ 错误
// ============================================
const {
  mockTermOpen,
  mockTermDispose,
  mockTermFocus,
  mockTermLoadAddon: _mockTermLoadAddon,
  mockFitAddonFit: _mockFitAddonFit,
  mockAttachAddonDispose: _mockAttachAddonDispose,
  mockWebglOnContextLoss: _mockWebglOnContextLoss,
  MockXTerm,
  MockWebglAddon,
  MockUnicode11Addon,
  MockAttachAddon,
  MockFitAddon,
} = vi.hoisted(() => {
  const mockTermOpen = vi.fn();
  const mockTermDispose = vi.fn();
  const mockTermFocus = vi.fn();
  const mockTermLoadAddon = vi.fn();
  const mockFitAddonFit = vi.fn();
  const mockAttachAddonDispose = vi.fn();
  const mockWebglOnContextLoss = vi.fn();

  const MockXTerm = vi.fn().mockImplementation(() => ({
    open: mockTermOpen,
    dispose: mockTermDispose,
    focus: mockTermFocus,
    loadAddon: mockTermLoadAddon,
    cols: 80,
    rows: 24,
    options: { theme: {} },
    unicode: { activeVersion: '6' },
    onData: vi.fn(),
    onResize: vi.fn(),
    write: vi.fn(),
    writeln: vi.fn(),
  }));

  const MockWebglAddon = vi.fn().mockImplementation(() => ({
    activate: vi.fn(),
    dispose: vi.fn(),
    onContextLoss: mockWebglOnContextLoss,
  }));

  const MockUnicode11Addon = vi.fn().mockImplementation(() => ({
    activate: vi.fn(),
    dispose: vi.fn(),
  }));

  const MockAttachAddon = vi.fn().mockImplementation(() => ({
    activate: vi.fn(),
    dispose: mockAttachAddonDispose,
  }));

  const MockFitAddon = vi.fn().mockImplementation(() => ({
    activate: vi.fn(),
    dispose: vi.fn(),
    fit: mockFitAddonFit,
  }));

  return {
    mockTermOpen,
    mockTermDispose,
    mockTermFocus,
    mockTermLoadAddon,
    mockFitAddonFit,
    mockAttachAddonDispose,
    mockWebglOnContextLoss,
    MockXTerm,
    MockWebglAddon,
    MockUnicode11Addon,
    MockAttachAddon,
    MockFitAddon,
  };
});

// ============================================
// 模块 mock（必须在 import 之前，vitest 会自动提升）
// ============================================
vi.mock('@xterm/xterm', () => ({ Terminal: MockXTerm }));
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: MockWebglAddon }));
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: MockUnicode11Addon }));
vi.mock('@xterm/addon-attach', () => ({ AttachAddon: MockAttachAddon }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: MockFitAddon }));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

// 在 mock 定义之后才能 import 被测模块
import Terminal from '../features/terminal/Terminal';
import { useTerminalStore } from '../features/terminal/terminalStore';
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_TERMINAL_SETTINGS, useSettingsStore } from '../shared/stores/settingsStore';

// ============================================
// Mock WebSocket（jsdom 无原生 WebSocket 实现）
// ============================================
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  url: string;
  binaryType: string = 'blob';
  readyState: number = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close() {
    this.readyState = 3;
    if (this.onclose) this.onclose({ code: 1000 });
  }
}

const mockInvoke = vi.mocked(invoke);

// 项目路径常量（用作 per-project session key）
const TEST_PROJECT_PATH = '/tmp/test';

describe('Terminal', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.clearAllMocks();
    localStorage.clear();

    useSettingsStore.setState({
      appView: 'main',
      terminal: DEFAULT_TERMINAL_SETTINGS,
    });

    // 重置 store 为新 API：sessions map + activeProjectPath
    useTerminalStore.setState({
      sessions: {},
      activeProjectPath: null,
    });

    // 默认 spawn 成功
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'get_default_shell_cmd') {
        return '/bin/zsh';
      }
      if (command === 'spawn_pty_cmd') {
        return {
          pty_id: 'test-pty-12345678',
          ws_port: 54321,
          ws_token: 'c'.repeat(64),
        };
      }
      return undefined;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('挂载时初始化 xterm.js', () => {
    it('应创建 XTerm 实例', async () => {
      render(<Terminal projectPath={TEST_PROJECT_PATH} />);
      expect(MockXTerm).toHaveBeenCalledTimes(1);
    });

    it('应调用 open 将终端挂载到 DOM 容器', async () => {
      render(<Terminal projectPath={TEST_PROJECT_PATH} />);
      expect(mockTermOpen).toHaveBeenCalledTimes(1);
    });

    it('应加载 WebglAddon', async () => {
      render(<Terminal projectPath={TEST_PROJECT_PATH} />);
      expect(MockWebglAddon).toHaveBeenCalledTimes(1);
    });

    it('WebglAddon 加载失败时应降级（不抛出错误）', async () => {
      // 模拟 WebGL 不可用
      MockWebglAddon.mockImplementationOnce(() => {
        throw new Error('WebGL 不支持');
      });
      expect(() => render(<Terminal projectPath={TEST_PROJECT_PATH} />)).not.toThrow();
      // XTerm 实例仍应创建（降级到 Canvas2D）
      expect(MockXTerm).toHaveBeenCalledTimes(1);
    });

    it('应加载 Unicode11Addon 支持宽字符', async () => {
      render(<Terminal projectPath={TEST_PROJECT_PATH} />);
      expect(MockUnicode11Addon).toHaveBeenCalledTimes(1);
    });

    it('应加载 FitAddon', async () => {
      render(<Terminal projectPath={TEST_PROJECT_PATH} />);
      expect(MockFitAddon).toHaveBeenCalledTimes(1);
    });
  });

  describe('PTY 生命周期', () => {
    it('挂载时应调用 spawnForProject 启动 PTY', async () => {
      render(<Terminal projectPath="/projects/test" />);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenNthCalledWith(1, 'get_default_shell_cmd');
        expect(mockInvoke).toHaveBeenNthCalledWith(2, 'spawn_pty_cmd', {
          shell: '/bin/zsh',
          cwd: '/projects/test',
        });
      });
    });

    it('应把终端设置传给 xterm 实例', async () => {
      useSettingsStore.getState().updateTerminalSettings({
        fontSize: 15,
        fontFamily: 'Fira Code, monospace',
        cursorStyle: 'underline',
        theme: 'ghostterm-light',
      });

      render(<Terminal projectPath={TEST_PROJECT_PATH} />);

      expect(MockXTerm).toHaveBeenCalledWith(
        expect.objectContaining({
          fontSize: 15,
          fontFamily: 'Fira Code, monospace',
          cursorStyle: 'underline',
        }),
      );
    });

    it('session 已存在时不应重复 spawn', async () => {
      // 预先注入一个已有 session，模拟项目已打开的场景
      useTerminalStore.setState({
        sessions: {
          [TEST_PROJECT_PATH]: {
            ptyId: 'existing-pty',
            wsPort: 9999,
            wsToken: 'a'.repeat(64),
            connected: false,
          },
        },
        activeProjectPath: TEST_PROJECT_PATH,
      });

      render(<Terminal projectPath={TEST_PROJECT_PATH} />);

      // 等待可能的异步操作
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // 不应调用 spawn_pty_cmd（session 已存在，跳过 spawn）
      expect(mockInvoke).not.toHaveBeenCalledWith('spawn_pty_cmd', expect.anything());
    });
  });

  describe('WebSocket 连接后 AttachAddon', () => {
    it('connected 变为 true 且有 WebSocket 实例时应加载 AttachAddon', async () => {
      render(<Terminal projectPath={TEST_PROJECT_PATH} />);

      // 等待 spawn 完成，store 有了 session
      await waitFor(() => {
        expect(useTerminalStore.getState().sessions[TEST_PROJECT_PATH]?.wsPort).toBe(54321);
      });

      // 模拟 WebSocket 已创建并连接（useTerminal hook 建立连接）
      await act(async () => {
        useTerminalStore.getState().setConnected(TEST_PROJECT_PATH, true);
      });

      await waitFor(() => {
        expect(MockAttachAddon).toHaveBeenCalledTimes(1);
      });
    });

    it('connected 变为 true 后应聚焦终端以接收键盘输入', async () => {
      render(<Terminal projectPath={TEST_PROJECT_PATH} />);

      await waitFor(() => {
        expect(useTerminalStore.getState().sessions[TEST_PROJECT_PATH]?.wsPort).toBe(54321);
      });

      await act(async () => {
        useTerminalStore.getState().setConnected(TEST_PROJECT_PATH, true);
      });

      await waitFor(() => {
        expect(mockTermFocus).toHaveBeenCalled();
      });
    });
  });

  describe('终端交互焦点', () => {
    it('点击终端容器时应聚焦 xterm 实例', async () => {
      const user = userEvent.setup();
      render(<Terminal projectPath={TEST_PROJECT_PATH} />);

      await user.click(screen.getByTestId('terminal-container'));

      expect(mockTermFocus).toHaveBeenCalled();
    });
  });

  describe('卸载时清理', () => {
    it('卸载时应 dispose XTerm 实例', async () => {
      const { unmount } = render(<Terminal projectPath={TEST_PROJECT_PATH} />);
      unmount();
      expect(mockTermDispose).toHaveBeenCalledTimes(1);
    });
  });

  describe('错误 UI', () => {
    it('spawn 失败时应显示错误信息', async () => {
      mockInvoke
        .mockResolvedValueOnce('/bin/zsh')
        .mockRejectedValueOnce(new Error('shell 不存在'));

      render(<Terminal projectPath={TEST_PROJECT_PATH} />);

      await waitFor(() => {
        expect(screen.getByText(/PTY 启动失败/)).toBeInTheDocument();
      });
    });

    it('spawn 失败时应显示重试按钮', async () => {
      mockInvoke
        .mockResolvedValueOnce('/bin/zsh')
        .mockRejectedValueOnce(new Error('连接超时'));

      render(<Terminal projectPath={TEST_PROJECT_PATH} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
      });
    });

    it('点击重试按钮应重新调用 spawnForProject', async () => {
      // 第一次失败
      mockInvoke
        .mockResolvedValueOnce('/bin/zsh')
        .mockRejectedValueOnce(new Error('第一次失败'));
      // 第二次成功
      mockInvoke
        .mockResolvedValueOnce('/bin/zsh')
        .mockResolvedValueOnce({
          pty_id: 'new-pty-id',
          ws_port: 11111,
          ws_token: 'd'.repeat(64),
        });

      render(<Terminal projectPath={TEST_PROJECT_PATH} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
      });

      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: '重试' }));

      await waitFor(() => {
        // 每次 spawnForProject 都会先取默认 shell，再调用 spawn_pty_cmd
        expect(mockInvoke).toHaveBeenCalledTimes(4);
      });
    });
  });

  describe('终端容器 DOM', () => {
    it('无错误时应渲染终端容器', async () => {
      render(<Terminal projectPath={TEST_PROJECT_PATH} />);

      // spawn 成功后应渲染终端容器（不显示错误 UI）
      await waitFor(() => {
        const container = document.querySelector('[data-testid="terminal-container"]');
        expect(container).toBeInTheDocument();
      });
    });
  });
});
