/**
 * @file Sidebar.test.tsx
 * @description Sidebar 组件测试 - 验证手风琴式项目详情和添加项目按钮
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Sidebar from '../Sidebar';
import { useSidebarStore } from '../sidebarStore';
import { useFileTreeStore } from '../fileTreeStore';
import { useProjectStore } from '../projectStore';
import { useProjectGroupingStore } from '../projectGroupingStore';
import { useGitStore } from '../gitStore';

beforeEach(() => {
  useSidebarStore.setState({ activeTab: 'files', visible: true });
  useFileTreeStore.setState({ tree: [], expandedPaths: new Set() });
  // Changes 组件挂载时会触发 refreshGitStatus，
  // 用 no-op 替代，防止 invoke mock 返回 undefined 污染 changes
  useGitStore.setState({
    changes: [],
    currentBranch: '',
    worktrees: [],
    refreshGitStatus: async () => {},
  });
  useProjectStore.setState({
    currentProject: { name: 'GhostTerm', path: '/Users/test/GhostTerm', last_opened: 1 },
    recentProjects: [
      { name: 'GhostTerm', path: '/Users/test/GhostTerm', last_opened: 1 },
      { name: 'OtherProject', path: '/Users/test/OtherProject', last_opened: 0 },
    ],
  });
  useProjectGroupingStore.setState({
    groups: [],
    selectedGroupId: 'all',
    projectGroupMap: {},
    searchQuery: '',
  });
});

describe('Sidebar - 基础渲染', () => {
  it('应渲染侧边栏容器', () => {
    render(<Sidebar />);
    expect(screen.getByTestId('sidebar-root')).toBeInTheDocument();
  });

  it('应渲染添加项目按钮', () => {
    render(<Sidebar />);
    expect(screen.getByTestId('add-project-btn')).toBeInTheDocument();
    expect(screen.getByText('添加项目')).toBeInTheDocument();
  });

  it('应渲染项目分组头和搜索栏', () => {
    render(<Sidebar />);
    expect(screen.getByTestId('project-group-header')).toBeInTheDocument();
    expect(screen.getByTestId('project-search-input')).toBeInTheDocument();
  });
});

describe('Sidebar - 手风琴标签页', () => {
  it('活跃项目应展开手风琴区域', () => {
    render(<Sidebar />);
    expect(screen.getByTestId('accordion-panel-GhostTerm')).toBeInTheDocument();
  });

  it('非活跃项目不应展开手风琴', () => {
    render(<Sidebar />);
    expect(screen.queryByTestId('accordion-panel-OtherProject')).not.toBeInTheDocument();
  });

  it('手风琴中应渲染三个标签页按钮', () => {
    render(<Sidebar />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
  });

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
});

describe('Sidebar - 无活跃项目', () => {
  it('无当前项目时不应显示任何标签页', () => {
    useProjectStore.setState({ currentProject: null });
    render(<Sidebar />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });
});
