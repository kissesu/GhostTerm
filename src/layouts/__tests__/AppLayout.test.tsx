/**
 * @file AppLayout.test.tsx
 * @description AppLayout Cmd+B 快捷键测试 - 验证侧边栏显隐切换
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AppLayout from '../AppLayout';
import { useSidebarStore } from '../../features/sidebar';
import { useFileTreeStore } from '../../features/sidebar';
import { useProjectStore } from '../../features/sidebar';

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
