/**
 * @file Worktrees.test.tsx
 * @description Worktrees 组件测试 - 验证 worktree 列表渲染和对话框化交互
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import Worktrees from '../Worktrees';
import { useGitStore } from '../gitStore';
import { useProjectStore } from '../projectStore';
import type { Worktree } from '../../../shared/types';

const mockInvoke = vi.mocked(invoke);
const refreshWorktreesMock = vi.fn().mockResolvedValue(undefined);

const mainWorktree: Worktree = {
  path: '/proj',
  branch: 'main',
  is_current: true,
};

const featureWorktree: Worktree = {
  path: '/proj-feature',
  branch: 'feature/new-ui',
  is_current: false,
};

beforeEach(() => {
  useGitStore.setState({
    changes: [],
    currentBranch: 'main',
    worktrees: [],
    refreshWorktrees: refreshWorktreesMock,
  });
  useProjectStore.setState({
    currentProject: { name: 'proj', path: '/proj', last_opened: 1 },
    recentProjects: [],
  });
  refreshWorktreesMock.mockClear();
  vi.clearAllMocks();
});

describe('Worktrees - 基础渲染', () => {
  it('应渲染 worktrees-panel 容器', () => {
    render(<Worktrees />);
    expect(screen.getByTestId('worktrees-panel')).toBeInTheDocument();
  });

  it('无 worktree 时应显示提示文字', () => {
    render(<Worktrees />);
    expect(screen.getByText('暂无 worktree 数据')).toBeInTheDocument();
  });

  it('应显示"新建"按钮', () => {
    render(<Worktrees />);
    expect(screen.getByText('+ 新建')).toBeInTheDocument();
  });
});

describe('Worktrees - 列表渲染', () => {
  it('应渲染 worktree 列表', () => {
    useGitStore.setState({ worktrees: [mainWorktree, featureWorktree] });
    render(<Worktrees />);

    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByText('feature/new-ui')).toBeInTheDocument();
  });

  it('当前 worktree 应显示"当前"标记', () => {
    useGitStore.setState({ worktrees: [mainWorktree] });
    render(<Worktrees />);

    expect(screen.getByText('当前')).toBeInTheDocument();
  });

  it('非当前 worktree 应显示切换和删除按钮', () => {
    useGitStore.setState({ worktrees: [mainWorktree, featureWorktree] });
    render(<Worktrees />);

    expect(screen.getByTitle('切换到 feature/new-ui')).toBeInTheDocument();
    expect(screen.getByTitle('删除 feature/new-ui')).toBeInTheDocument();
  });

  it('当前 worktree 不应显示切换和删除按钮', () => {
    useGitStore.setState({ worktrees: [mainWorktree] });
    render(<Worktrees />);

    expect(screen.queryByTitle('切换到 main')).not.toBeInTheDocument();
  });
});

describe('Worktrees - 切换操作', () => {
  it('点击切换按钮应通过 openProject 切换到目标 worktree', async () => {
    mockInvoke
      .mockResolvedValueOnce({ name: 'proj-feature', path: '/proj-feature', last_opened: 0 })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce('main')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    useGitStore.setState({ worktrees: [mainWorktree, featureWorktree] });

    render(<Worktrees />);

    fireEvent.click(screen.getByTitle('切换到 feature/new-ui'));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('open_project_cmd', {
        path: '/proj-feature',
      });
    });
  });
});

describe('Worktrees - 对话框交互', () => {
  it('创建 worktree 应通过对话框调用 worktree_add_cmd', async () => {
    const user = userEvent.setup();
    render(<Worktrees />);

    await user.click(screen.getByText('+ 新建'));
    expect(screen.getByTestId('worktree-create-dialog')).toBeInTheDocument();

    await user.type(screen.getByTestId('worktree-create-branch-input'), 'feature/sidebar-polish');
    await user.type(screen.getByTestId('worktree-create-path-input'), '/tmp/sidebar-polish');
    await user.click(screen.getByTestId('worktree-create-confirm'));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('worktree_add_cmd', {
        repoPath: '/proj',
        path: '/tmp/sidebar-polish',
        branch: 'feature/sidebar-polish',
      });
    });

    expect(refreshWorktreesMock).toHaveBeenCalledWith('/proj');
    expect(screen.queryByTestId('worktree-create-dialog')).not.toBeInTheDocument();
  });

  it('删除非当前 worktree 应先显示确认对话框再调用 worktree_remove_cmd', async () => {
    const user = userEvent.setup();
    useGitStore.setState({ worktrees: [mainWorktree, featureWorktree] });
    render(<Worktrees />);

    await user.click(screen.getByTitle('删除 feature/new-ui'));
    expect(screen.getByTestId('worktree-remove-dialog')).toBeInTheDocument();

    await user.click(screen.getByTestId('worktree-remove-confirm'));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('worktree_remove_cmd', {
        repoPath: '/proj',
        worktreeName: '/proj-feature',
      });
    });

    expect(refreshWorktreesMock).toHaveBeenCalledWith('/proj');
  });

  it('创建失败时应显示错误对话框', async () => {
    const user = userEvent.setup();
    mockInvoke.mockRejectedValueOnce(new Error('boom'));
    render(<Worktrees />);

    await user.click(screen.getByText('+ 新建'));
    await user.type(screen.getByTestId('worktree-create-branch-input'), 'feature/sidebar-polish');
    await user.type(screen.getByTestId('worktree-create-path-input'), '/tmp/sidebar-polish');
    await user.click(screen.getByTestId('worktree-create-confirm'));

    expect(await screen.findByTestId('worktree-error-dialog')).toBeInTheDocument();
    expect(screen.getByText(/创建失败:/)).toBeInTheDocument();
  });

  it('切换失败时应显示错误对话框', async () => {
    const user = userEvent.setup();
    const openProjectMock = vi.fn().mockRejectedValue(new Error('boom'));
    useProjectStore.setState({
      openProject: openProjectMock,
      currentProject: { name: 'proj', path: '/proj', last_opened: 1 },
    });
    useGitStore.setState({ worktrees: [mainWorktree, featureWorktree] });

    render(<Worktrees />);

    await user.click(screen.getByTitle('切换到 feature/new-ui'));

    expect(await screen.findByTestId('worktree-error-dialog')).toBeInTheDocument();
    expect(screen.getByText(/切换失败:/)).toBeInTheDocument();
  });
});

describe('Worktrees - 计数显示', () => {
  it('标题应显示 worktree 数量', () => {
    useGitStore.setState({ worktrees: [mainWorktree, featureWorktree] });
    render(<Worktrees />);

    expect(screen.getByText(/Worktrees \(2\)/i)).toBeInTheDocument();
  });
});
