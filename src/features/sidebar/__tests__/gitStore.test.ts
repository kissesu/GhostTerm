/**
 * @file gitStore.test.ts
 * @description gitStore 单元测试 - 验证 git 状态刷新、暂存/取消暂存操作
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useGitStore } from '../gitStore';
import type { StatusEntry, Worktree } from '../../../shared/types';

const mockInvoke = vi.mocked(invoke);

// 测试用数据
const sampleChanges: StatusEntry[] = [
  { path: 'src/main.ts', staged: 'M', unstaged: undefined },
  { path: 'src/new.ts', staged: undefined, unstaged: '?' },
  { path: 'README.md', staged: 'A', unstaged: 'M' },
];

const sampleWorktrees: Worktree[] = [
  { path: '/proj', branch: 'main', is_current: true },
  { path: '/proj-feat', branch: 'feature', is_current: false },
];

beforeEach(() => {
  // 重置 store 为初始状态
  useGitStore.setState({
    changes: [],
    currentBranch: '',
    worktrees: [],
  });
  vi.clearAllMocks();
});

describe('gitStore - refreshGitStatus', () => {
  it('应并行调用 git_status_cmd 和 git_current_branch_cmd', async () => {
    mockInvoke
      .mockResolvedValueOnce(sampleChanges)
      .mockResolvedValueOnce('main');

    await useGitStore.getState().refreshGitStatus('/proj');

    expect(mockInvoke).toHaveBeenCalledWith('git_status_cmd', { repoPath: '/proj' });
    expect(mockInvoke).toHaveBeenCalledWith('git_current_branch_cmd', { repoPath: '/proj' });
  });

  it('refreshGitStatus 应填充 changes', async () => {
    mockInvoke
      .mockResolvedValueOnce(sampleChanges)
      .mockResolvedValueOnce('main');

    await useGitStore.getState().refreshGitStatus('/proj');

    const { changes } = useGitStore.getState();
    expect(changes).toHaveLength(3);
    expect(changes[0].path).toBe('src/main.ts');
  });

  it('refreshGitStatus 应填充 currentBranch', async () => {
    mockInvoke
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce('feat/my-feature');

    await useGitStore.getState().refreshGitStatus('/proj');

    const { currentBranch } = useGitStore.getState();
    expect(currentBranch).toBe('feat/my-feature');
  });
});

describe('gitStore - refreshWorktrees', () => {
  it('应调用 worktree_list_cmd', async () => {
    mockInvoke.mockResolvedValueOnce(sampleWorktrees);

    await useGitStore.getState().refreshWorktrees('/proj');

    expect(mockInvoke).toHaveBeenCalledWith('worktree_list_cmd', { repoPath: '/proj' });
  });

  it('refreshWorktrees 应填充 worktrees', async () => {
    mockInvoke.mockResolvedValueOnce(sampleWorktrees);

    await useGitStore.getState().refreshWorktrees('/proj');

    const { worktrees } = useGitStore.getState();
    expect(worktrees).toHaveLength(2);
    expect(worktrees[0].branch).toBe('main');
    expect(worktrees[0].is_current).toBe(true);
  });
});

describe('gitStore - stageFile', () => {
  it('应调用 git_stage_cmd', async () => {
    // stageFile 内部调用 stageFile 后再调用 refreshGitStatus
    mockInvoke
      .mockResolvedValueOnce(undefined)       // git_stage_cmd
      .mockResolvedValueOnce(sampleChanges)    // git_status_cmd (refresh)
      .mockResolvedValueOnce('main');           // git_current_branch_cmd (refresh)

    await useGitStore.getState().stageFile('/proj', 'src/new.ts');

    expect(mockInvoke).toHaveBeenCalledWith('git_stage_cmd', {
      repoPath: '/proj',
      filePath: 'src/new.ts',
    });
  });

  it('stageFile 完成后应刷新状态', async () => {
    const updatedChanges: StatusEntry[] = [
      { path: 'src/new.ts', staged: 'A', unstaged: undefined },
    ];

    mockInvoke
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(updatedChanges)
      .mockResolvedValueOnce('main');

    await useGitStore.getState().stageFile('/proj', 'src/new.ts');

    const { changes } = useGitStore.getState();
    expect(changes[0].staged).toBe('A');
  });
});

describe('gitStore - unstageFile', () => {
  it('应调用 git_unstage_cmd', async () => {
    mockInvoke
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce('main');

    await useGitStore.getState().unstageFile('/proj', 'src/main.ts');

    expect(mockInvoke).toHaveBeenCalledWith('git_unstage_cmd', {
      repoPath: '/proj',
      filePath: 'src/main.ts',
    });
  });

  it('unstageFile 完成后应刷新状态', async () => {
    const afterUnstage: StatusEntry[] = [
      { path: 'src/main.ts', staged: undefined, unstaged: 'M' },
    ];

    mockInvoke
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(afterUnstage)
      .mockResolvedValueOnce('main');

    await useGitStore.getState().unstageFile('/proj', 'src/main.ts');

    const { changes } = useGitStore.getState();
    expect(changes[0].staged).toBeUndefined();
    expect(changes[0].unstaged).toBe('M');
  });
});
