/**
 * @file test/Terminal.test.tsx - Terminal 组件单元测试
 * @description 测试 Terminal 组件挂载行为：
 *              - xterm.js 实例创建和 DOM 挂载
 *              - WebGL addon 加载（失败时降级）
 *              - AttachAddon 在 WebSocket 连接后加载
 *              - 错误 UI 显示和重试按钮
 * @author Atlas.oi
 * @date 2026-04-13
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
  const mockTermLoadAddon = vi.fn();
  const mockFitAddonFit = vi.fn();
  const mockAttachAddonDispose = vi.fn();
  const mockWebglOnContextLoss = vi.fn();

  const MockXTerm = vi.fn().mockImplementation(() => ({
    open: mockTermOpen,
    dispose: mockTermDispose,
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

// ============================================
// Mock WebSocket（jsdom 无原生 WebSocket 实现）
// ============================================
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  binaryType: string = 'blob';
  readyState: number = 1;
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

describe('Terminal', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.clearAllMocks();

    // 重置 store
    useTerminalStore.setState({
      ptyId: null,
      wsPort: null,
      wsToken: null,
      connected: false,
    });

    // 默认 spawn 成功
    mockInvoke.mockResolvedValue({
      pty_id: 'test-pty-12345678',
      ws_port: 54321,
      ws_token: 'c'.repeat(64),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('挂载时初始化 xterm.js', () => {
    it('应创建 XTerm 实例', async () => {
      render(<Terminal cwd="/tmp" />);
      expect(MockXTerm).toHaveBeenCalledTimes(1);
    });

    it('应调用 open 将终端挂载到 DOM 容器', async () => {
      render(<Terminal cwd="/tmp" />);
      expect(mockTermOpen).toHaveBeenCalledTimes(1);
    });

    it('应加载 WebglAddon', async () => {
      render(<Terminal cwd="/tmp" />);
      expect(MockWebglAddon).toHaveBeenCalledTimes(1);
    });

    it('WebglAddon 加载失败时应降级（不抛出错误）', async () => {
      // 模拟 WebGL 不可用
      MockWebglAddon.mockImplementationOnce(() => {
        throw new Error('WebGL 不支持');
      });
      expect(() => render(<Terminal cwd="/tmp" />)).not.toThrow();
      // XTerm 实例仍应创建（降级到 Canvas2D）
      expect(MockXTerm).toHaveBeenCalledTimes(1);
    });

    it('应加载 Unicode11Addon 支持宽字符', async () => {
      render(<Terminal cwd="/tmp" />);
      expect(MockUnicode11Addon).toHaveBeenCalledTimes(1);
    });

    it('应加载 FitAddon', async () => {
      render(<Terminal cwd="/tmp" />);
      expect(MockFitAddon).toHaveBeenCalledTimes(1);
    });
  });

  describe('PTY 生命周期', () => {
    it('挂载时应调用 spawn PTY', async () => {
      render(<Terminal cwd="/projects/test" />);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('spawn_pty_cmd', {
          shell: '/bin/sh',
          cwd: '/projects/test',
        });
      });
    });
  });

  describe('WebSocket 连接后 AttachAddon', () => {
    it('connected 变为 true 且有 WebSocket 实例时应加载 AttachAddon', async () => {
      render(<Terminal cwd="/tmp" />);

      // 等待 spawn 完成，store 有了 wsPort/wsToken
      await waitFor(() => {
        expect(useTerminalStore.getState().wsPort).toBe(54321);
      });

      // 模拟 WebSocket 已创建（useTerminal hook 建立连接）
      await act(async () => {
        useTerminalStore.setState({ connected: true });
      });

      await waitFor(() => {
        expect(MockAttachAddon).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('卸载时清理', () => {
    it('卸载时应 dispose XTerm 实例', async () => {
      const { unmount } = render(<Terminal cwd="/tmp" />);
      unmount();
      expect(mockTermDispose).toHaveBeenCalledTimes(1);
    });
  });

  describe('错误 UI', () => {
    it('spawn 失败时应显示错误信息', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('shell 不存在'));

      render(<Terminal cwd="/tmp" />);

      await waitFor(() => {
        expect(screen.getByText(/PTY 启动失败/)).toBeInTheDocument();
      });
    });

    it('spawn 失败时应显示重试按钮', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('连接超时'));

      render(<Terminal cwd="/tmp" />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
      });
    });

    it('点击重试按钮应重新调用 spawn', async () => {
      // 第一次失败
      mockInvoke.mockRejectedValueOnce(new Error('第一次失败'));
      // 第二次成功
      mockInvoke.mockResolvedValueOnce({
        pty_id: 'new-pty-id',
        ws_port: 11111,
        ws_token: 'd'.repeat(64),
      });

      render(<Terminal cwd="/tmp" />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
      });

      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: '重试' }));

      await waitFor(() => {
        // spawn 被调用了两次（初始 + 重试）
        expect(mockInvoke).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('终端容器 DOM', () => {
    it('无错误时应渲染终端容器', async () => {
      render(<Terminal cwd="/tmp" />);

      // spawn 成功后应渲染终端容器（不显示错误 UI）
      await waitFor(() => {
        const container = document.querySelector('[data-testid="terminal-container"]');
        expect(container).toBeInTheDocument();
      });
    });
  });
});
