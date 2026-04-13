/**
 * @file Sidebar.test.tsx
 * @description Sidebar 组件测试 - 验证三标签页容器和内容切换行为
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Sidebar from '../Sidebar';
import { useSidebarStore } from '../sidebarStore';
import { useFileTreeStore } from '../fileTreeStore';
import { useProjectStore } from '../projectStore';

beforeEach(() => {
  useSidebarStore.setState({ activeTab: 'files', visible: true });
  useFileTreeStore.setState({ tree: [], expandedPaths: new Set() });
  useProjectStore.setState({ currentProject: null, recentProjects: [] });
});

describe('Sidebar - 基础渲染', () => {
  it('应渲染侧边栏容器', () => {
    render(<Sidebar />);
    expect(screen.getByTestId('sidebar-root')).toBeInTheDocument();
  });

  it('应渲染三个标签页按钮', () => {
    render(<Sidebar />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
  });

  it('应包含 Files、Changes、Worktrees 标签', () => {
    render(<Sidebar />);
    expect(screen.getByRole('tab', { name: 'Files' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Changes' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Worktrees' })).toBeInTheDocument();
  });
});

describe('Sidebar - 标签页切换', () => {
  it('初始应激活 files 标签', () => {
    render(<Sidebar />);
    const filesTab = screen.getByRole('tab', { name: 'Files' });
    expect(filesTab).toHaveAttribute('aria-selected', 'true');
  });

  it('点击 Changes 标签应切换激活状态', () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole('tab', { name: 'Changes' }));

    expect(screen.getByRole('tab', { name: 'Changes' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'false');
  });

  it('点击 Worktrees 标签应切换激活状态', () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole('tab', { name: 'Worktrees' }));

    expect(screen.getByRole('tab', { name: 'Worktrees' })).toHaveAttribute('aria-selected', 'true');
  });

  it('Files 面板在 changes 激活时应隐藏（hidden 属性）', () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole('tab', { name: 'Changes' }));

    // 通过 data-testid 查询（hidden 元素不影响 getByTestId 行为）
    const filesPanel = screen.getByTestId('panel-files');
    expect(filesPanel).toHaveAttribute('hidden');
  });

  it('Changes 面板在 changes 激活时应可见（不含 hidden 属性）', () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole('tab', { name: 'Changes' }));

    const changesPanel = screen.getByTestId('panel-changes');
    expect(changesPanel).not.toHaveAttribute('hidden');
  });
});

describe('Sidebar - 包含 ProjectSelector', () => {
  it('应渲染项目选择器区域', () => {
    render(<Sidebar />);
    // ProjectSelector 渲染后存在"选择项目"按钮
    expect(screen.getByRole('button', { name: '选择项目' })).toBeInTheDocument();
  });
});
