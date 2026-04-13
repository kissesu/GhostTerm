/**
 * @file AppLayout.test.tsx
 * @description AppLayout Cmd+B 快捷键测试 - 验证侧边栏显隐切换
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AppLayout from '../AppLayout';
import { useSidebarStore } from '../../features/sidebar';
import { useFileTreeStore } from '../../features/sidebar';
import { useProjectStore } from '../../features/sidebar';

// AppLayout 测试只验证布局/键盘行为，特性组件 mock 为轻量占位
// 避免 xterm.js/CodeMirror 依赖浏览器 API 在 jsdom 中报错
vi.mock('../../features/terminal', () => ({
  Terminal: () => <div data-testid="terminal-panel">终端</div>,
}));
vi.mock('../../features/editor', () => ({
  Editor: () => <div data-testid="editor-panel">编辑器</div>,
  EditorTabs: () => <div data-testid="editor-tabs" />,
}));

beforeEach(() => {
  useSidebarStore.setState({ activeTab: 'files', visible: true });
  useFileTreeStore.setState({ tree: [], expandedPaths: new Set() });
  useProjectStore.setState({ currentProject: null, recentProjects: [] });
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
