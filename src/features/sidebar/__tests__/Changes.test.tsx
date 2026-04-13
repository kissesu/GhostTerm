/**
 * @file Changes.test.tsx
 * @description Changes 组件测试 - 验证 staged/unstaged 列表渲染和按钮交互
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Changes from '../Changes';
import { useGitStore } from '../gitStore';
import type { StatusEntry } from '../../../shared/types';

// 测试用数据
const stagedEntry: StatusEntry = { path: 'src/staged.ts', staged: 'A', unstaged: undefined };
const unstagedEntry: StatusEntry = { path: 'src/modified.ts', staged: undefined, unstaged: 'M' };
const deletedEntry: StatusEntry = { path: 'src/deleted.ts', staged: undefined, unstaged: 'D' };

beforeEach(() => {
  useGitStore.setState({
    changes: [],
    currentBranch: 'main',
    worktrees: [],
  });
  vi.clearAllMocks();
});

describe('Changes - 基础渲染', () => {
  it('应渲染 changes-panel 容器', () => {
    render(<Changes />);
    expect(screen.getByTestId('changes-panel')).toBeInTheDocument();
  });

  it('无变更时应显示"无暂存文件"和"无未暂存文件"', () => {
    render(<Changes />);
    expect(screen.getByText('无暂存文件')).toBeInTheDocument();
    expect(screen.getByText('无未暂存文件')).toBeInTheDocument();
  });
});

describe('Changes - Staged 列表', () => {
  it('应渲染 staged 文件', () => {
    useGitStore.setState({ changes: [stagedEntry] });
    render(<Changes />);

    // 文件名显示
    expect(screen.getByText('staged.ts')).toBeInTheDocument();
    // Unstage 按钮（通过 title 属性查询）
    expect(screen.getByTitle('Unstage src/staged.ts')).toBeInTheDocument();
  });

  it('staged 文件显示状态标记 A', () => {
    useGitStore.setState({ changes: [stagedEntry] });
    render(<Changes />);

    // 状态标记 A 应出现
    const statusBadge = screen.getByTitle('新增');
    expect(statusBadge).toBeInTheDocument();
    expect(statusBadge.textContent).toBe('A');
  });

  it('Staged 分区显示计数', () => {
    useGitStore.setState({ changes: [stagedEntry] });
    render(<Changes />);

    // "Staged (1)" 标题
    expect(screen.getByText(/Staged \(1\)/i)).toBeInTheDocument();
  });
});

describe('Changes - Unstaged 列表', () => {
  it('应渲染 unstaged 文件', () => {
    useGitStore.setState({ changes: [unstagedEntry] });
    render(<Changes />);

    expect(screen.getByText('modified.ts')).toBeInTheDocument();
    // Stage 按钮（通过 title 属性查询）
    expect(screen.getByTitle('Stage src/modified.ts')).toBeInTheDocument();
  });

  it('deleted 文件显示 D 标记', () => {
    useGitStore.setState({ changes: [deletedEntry] });
    render(<Changes />);

    const statusBadge = screen.getByTitle('删除');
    expect(statusBadge.textContent).toBe('D');
  });
});

describe('Changes - 按钮交互', () => {
  it('点击 Stage 按钮应调用 gitStore.stageFile', async () => {
    const stageFile = vi.fn().mockResolvedValue(undefined);
    useGitStore.setState({ changes: [unstagedEntry], stageFile });

    render(<Changes />);

    const stageBtn = screen.getByTitle('Stage src/modified.ts');
    fireEvent.click(stageBtn);

    await waitFor(() => {
      expect(stageFile).toHaveBeenCalled();
    });
  });

  it('点击 Unstage 按钮应调用 gitStore.unstageFile', async () => {
    const unstageFile = vi.fn().mockResolvedValue(undefined);
    useGitStore.setState({ changes: [stagedEntry], unstageFile });

    render(<Changes />);

    const unstageBtn = screen.getByTitle('Unstage src/staged.ts');
    fireEvent.click(unstageBtn);

    await waitFor(() => {
      expect(unstageFile).toHaveBeenCalled();
    });
  });
});

describe('Changes - 混合状态文件', () => {
  it('同一文件既 staged 又 unstaged 时应在两个区域显示', () => {
    const bothEntry: StatusEntry = {
      path: 'src/partial.ts',
      staged: 'M',
      unstaged: 'M',
    };
    useGitStore.setState({ changes: [bothEntry] });

    render(<Changes />);

    // 同一文件名应出现两次（staged + unstaged 各一次）
    const fileNames = screen.getAllByText('partial.ts');
    expect(fileNames).toHaveLength(2);
  });
});
