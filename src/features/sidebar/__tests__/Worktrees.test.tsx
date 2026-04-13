/**
 * @file Worktrees.test.tsx
 * @description Worktrees 组件测试 - 验证 worktree 列表渲染和切换/删除交互
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import Worktrees from '../Worktrees';
import { useGitStore } from '../gitStore';
import type { Worktree } from '../../../shared/types';

const mockInvoke = vi.mocked(invoke);

// 测试用数据
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
  });
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

    // 分支名显示
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

    // featureWorktree 是非当前，应有切换和删除按钮
    expect(screen.getByTitle('切换到 feature/new-ui')).toBeInTheDocument();
    expect(screen.getByTitle('删除 feature/new-ui')).toBeInTheDocument();
  });

  it('当前 worktree 不应显示切换和删除按钮', () => {
    useGitStore.setState({ worktrees: [mainWorktree] });
    render(<Worktrees />);

    // mainWorktree 是当前，不应有切换按钮
    expect(screen.queryByTitle('切换到 main')).not.toBeInTheDocument();
  });
});

describe('Worktrees - 切换操作', () => {
  it('点击切换按钮应通过 openProject 切换到目标 worktree', async () => {
    // openProject 协调链路：open_project_cmd + list_dir_cmd + git 状态 + recent
    mockInvoke
      .mockResolvedValueOnce({ name: 'proj-feature', path: '/proj-feature', last_opened: 0 })
      .mockResolvedValueOnce([])    // list_dir_cmd
      .mockResolvedValueOnce([])    // git_status_cmd
      .mockResolvedValueOnce('main') // git_current_branch_cmd
      .mockResolvedValueOnce([])    // worktree_list_cmd
      .mockResolvedValueOnce([]);   // list_recent_projects_cmd
    useGitStore.setState({ worktrees: [mainWorktree, featureWorktree] });

    render(<Worktrees />);

    const switchBtn = screen.getByTitle('切换到 feature/new-ui');
    fireEvent.click(switchBtn);

    // 应调用 open_project_cmd（而非 worktree_switch_cmd）完成全链路协调
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('open_project_cmd', {
        path: '/proj-feature',
      });
    });
  });
});

describe('Worktrees - 计数显示', () => {
  it('标题应显示 worktree 数量', () => {
    useGitStore.setState({ worktrees: [mainWorktree, featureWorktree] });
    render(<Worktrees />);

    // "Worktrees (2)" 应出现
    expect(screen.getByText(/Worktrees \(2\)/i)).toBeInTheDocument();
  });
});
