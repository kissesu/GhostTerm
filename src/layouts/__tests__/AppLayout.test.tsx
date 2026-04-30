/**
 * @file AppLayout.test.tsx
 * @description AppLayout 行为测试 - 快捷键、焦点切换、窗口自适应折叠（PBI-6.5）
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import AppLayout from '../AppLayout';
import { useSidebarStore } from '../../features/sidebar';
import { useFileTreeStore } from '../../features/sidebar';
import { useProjectStore } from '../../features/sidebar';
import { useGlobalAuthStore } from '../../shared/stores/globalAuthStore';

const mockInvoke = vi.mocked(invoke);

// AppLayout 顶层有"全局登录门"：未登录时直接返回 GlobalLoginPage。
// 测试只关心布局/快捷键行为，统一在 beforeEach 注入已登录用户绕过登录门。
const TEST_USER = {
  id: 1,
  username: 'tester',
  displayName: 'Tester',
  roleId: 2,
  isActive: true,
  createdAt: '2026-04-29T00:00:00Z',
  permissions: [] as string[],
};

// AppLayout 测试只验证布局/键盘行为，特性组件 mock 为轻量占位
// 避免 xterm.js/CodeMirror 依赖浏览器 API 在 jsdom 中报错
vi.mock('../../features/terminal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../features/terminal')>();
  return {
    ...actual,
    Terminal: () => <div data-testid="terminal-panel">终端</div>,
  };
});
vi.mock('../../features/editor', () => ({
  Editor: () => <div data-testid="editor-panel">编辑器</div>,
  EditorTabs: () => <div data-testid="editor-tabs" />,
}));

beforeEach(() => {
  useSidebarStore.setState({ activeTab: 'files', visible: true });
  useFileTreeStore.setState({ tree: [], expandedPaths: new Set() });
  useProjectStore.setState({ currentProject: null, recentProjects: [] });
  useGlobalAuthStore.setState({
    accessToken: 'test-token',
    refreshToken: 'test-refresh',
    user: TEST_USER,
    loading: false,
    error: null,
  });
  // 启动恢复 effect 会调用 list_recent_projects_cmd，返回空数组跳过自动打开
  mockInvoke.mockResolvedValue([]);
});

describe('AppLayout - Cmd+B 快捷键', () => {
  it('侧边栏初始应可见', () => {
    render(<AppLayout />);
    expect(screen.getByTestId('sidebar-root')).toBeInTheDocument();
  });

  it('Cmd+B 应隐藏侧边栏', () => {
    render(<AppLayout />);
    fireEvent.keyDown(window, { key: 'b', metaKey: true });
    expect(screen.queryByTestId('sidebar-root')).not.toBeInTheDocument();
  });

  it('再次 Cmd+B 应恢复显示侧边栏', () => {
    render(<AppLayout />);
    fireEvent.keyDown(window, { key: 'b', metaKey: true });
    fireEvent.keyDown(window, { key: 'b', metaKey: true });
    expect(screen.getByTestId('sidebar-root')).toBeInTheDocument();
  });

  it('Ctrl+B 也应切换侧边栏', () => {
    render(<AppLayout />);
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(screen.queryByTestId('sidebar-root')).not.toBeInTheDocument();
  });

  it('其他快捷键不应影响侧边栏', () => {
    render(<AppLayout />);
    fireEvent.keyDown(window, { key: 'p', metaKey: true });
    expect(screen.getByTestId('sidebar-root')).toBeInTheDocument();
  });
});

// ============================================
// PBI-6.5: Cmd+` 焦点切换测试
// AppLayout 通过 data-active-panel 属性反映当前焦点面板
// ============================================
describe('AppLayout - Cmd+` 焦点切换', () => {
  it('Cmd+` 应将焦点切换到终端面板', () => {
    const { container } = render(<AppLayout />);
    // 初始焦点在编辑器
    const root = container.querySelector('[data-active-panel]');
    expect(root).toHaveAttribute('data-active-panel', 'editor');

    fireEvent.keyDown(window, { key: '`', metaKey: true });

    expect(root).toHaveAttribute('data-active-panel', 'terminal');
  });

  it('再次 Cmd+` 应将焦点切回编辑器面板', () => {
    const { container } = render(<AppLayout />);
    const root = container.querySelector('[data-active-panel]');

    // 第一次切换到终端
    fireEvent.keyDown(window, { key: '`', metaKey: true });
    expect(root).toHaveAttribute('data-active-panel', 'terminal');

    // 第二次切回编辑器（handleFocusToggle 中若当前已是目标面板则切回 editor）
    fireEvent.keyDown(window, { key: '`', metaKey: true });
    expect(root).toHaveAttribute('data-active-panel', 'editor');
  });

  it('Ctrl+` 也应切换焦点（跨平台兼容）', () => {
    const { container } = render(<AppLayout />);
    const root = container.querySelector('[data-active-panel]');

    fireEvent.keyDown(window, { key: '`', ctrlKey: true });

    expect(root).toHaveAttribute('data-active-panel', 'terminal');
  });
});

// ============================================
// PBI-6.5: 窗口宽度自动折叠侧边栏测试
// 窗口宽度 < 800px 时应自动隐藏侧边栏
// ============================================
describe('AppLayout - 窗口宽度自动折叠侧边栏', () => {
  afterEach(() => {
    // 恢复默认宽度，避免影响后续测试
    Object.defineProperty(window, 'innerWidth', {
      value: 1280,
      configurable: true,
      writable: true,
    });
  });

  it('窗口宽度 < 800px 时应自动隐藏侧边栏', () => {
    // 先设置宽度为窄屏再渲染，useEffect 初次执行时 checkWidth 会触发
    Object.defineProperty(window, 'innerWidth', {
      value: 600,
      configurable: true,
      writable: true,
    });
    render(<AppLayout />);

    // 侧边栏应被自动折叠
    expect(screen.queryByTestId('sidebar-root')).not.toBeInTheDocument();
  });

  it('窗口宽度恢复 >= 800px 时应自动展开侧边栏（自动折叠场景）', () => {
    // 先在窄屏下渲染（自动折叠）
    Object.defineProperty(window, 'innerWidth', {
      value: 600,
      configurable: true,
      writable: true,
    });
    render(<AppLayout />);
    expect(screen.queryByTestId('sidebar-root')).not.toBeInTheDocument();

    // 恢复宽度并触发 resize 事件
    Object.defineProperty(window, 'innerWidth', {
      value: 1280,
      configurable: true,
      writable: true,
    });
    fireEvent(window, new Event('resize'));

    // 侧边栏应自动展开（因为是自动折叠，userCollapsedRef=false）
    expect(screen.getByTestId('sidebar-root')).toBeInTheDocument();
  });

  it('用户手动 Cmd+B 折叠后，窗口宽度恢复时不应自动展开', () => {
    // 在宽屏下渲染
    Object.defineProperty(window, 'innerWidth', {
      value: 1280,
      configurable: true,
      writable: true,
    });
    render(<AppLayout />);
    expect(screen.getByTestId('sidebar-root')).toBeInTheDocument();

    // 用户手动 Cmd+B 折叠（userCollapsedRef 应变为 true）
    fireEvent.keyDown(window, { key: 'b', metaKey: true });
    expect(screen.queryByTestId('sidebar-root')).not.toBeInTheDocument();

    // 触发 resize（仍是宽屏）——应保持折叠，不自动恢复
    fireEvent(window, new Event('resize'));

    // 侧边栏应保持隐藏（用户意图被尊重）
    expect(screen.queryByTestId('sidebar-root')).not.toBeInTheDocument();
  });
});

describe('AppLayout - 面板滚动边界', () => {
  it('主工作区和编辑器/终端面板应允许收缩而不撑开页面', () => {
    render(<AppLayout />);

    const group = screen.getByTestId('editor-tabs').parentElement?.parentElement;
    const editorPanel = screen.getByTestId('editor-panel').parentElement;
    // 终端面板是 PanelGroup 的最后一个 Panel，包裹多个 Terminal 实例用 display:none 保留 scrollback
    const terminalPanelRoot = screen.getByTestId('editor-tabs').parentElement?.parentElement?.parentElement?.lastElementChild;

    expect(group).toHaveStyle({ minWidth: '0', minHeight: '0' });
    expect(editorPanel).toHaveStyle({ minWidth: '0', minHeight: '0', overflow: 'hidden' });
    expect(terminalPanelRoot).toHaveStyle({ minWidth: '0', minHeight: '0', overflow: 'hidden' });
  });
});
