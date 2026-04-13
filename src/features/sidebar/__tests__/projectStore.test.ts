/**
 * @file projectStore.test.ts
 * @description projectStore 单元测试 - 验证项目切换和关闭行为
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useProjectStore } from '../projectStore';
import type { ProjectInfo } from '../../../shared/types';

const mockInvoke = vi.mocked(invoke);

// 测试用的 ProjectInfo 样本
const sampleProject: ProjectInfo = {
  name: 'ghostterm',
  path: '/Users/test/ghostterm',
  last_opened: 1713024000000,
};

const anotherProject: ProjectInfo = {
  name: 'my-app',
  path: '/Users/test/my-app',
  last_opened: 1713020000000,
};

// 每个测试前重置 store 状态，避免测试间污染
beforeEach(() => {
  useProjectStore.setState({
    currentProject: null,
    recentProjects: [],
  });
  vi.clearAllMocks();
});

describe('projectStore - switchProject', () => {
  it('switchProject 应更新 currentProject', async () => {
    // open_project_cmd 返回项目信息，list_recent_projects_cmd 返回列表
    mockInvoke
      .mockResolvedValueOnce(sampleProject)        // open_project_cmd
      .mockResolvedValueOnce([sampleProject]);      // list_recent_projects_cmd

    await useProjectStore.getState().switchProject('/Users/test/ghostterm');

    const state = useProjectStore.getState();
    expect(state.currentProject).toEqual(sampleProject);
  });

  it('switchProject 应更新 recentProjects', async () => {
    mockInvoke
      .mockResolvedValueOnce(sampleProject)
      .mockResolvedValueOnce([sampleProject, anotherProject]);

    await useProjectStore.getState().switchProject('/Users/test/ghostterm');

    const state = useProjectStore.getState();
    expect(state.recentProjects).toHaveLength(2);
    expect(state.recentProjects[0]).toEqual(sampleProject);
  });

  it('switchProject 应按顺序调用 open_project_cmd 和 list_recent_projects_cmd', async () => {
    mockInvoke
      .mockResolvedValueOnce(sampleProject)
      .mockResolvedValueOnce([sampleProject]);

    await useProjectStore.getState().switchProject('/Users/test/ghostterm');

    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'open_project_cmd', {
      path: '/Users/test/ghostterm',
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'list_recent_projects_cmd');
  });
});

describe('projectStore - closeProject', () => {
  it('closeProject 应清空 currentProject', async () => {
    // 先设置当前项目
    useProjectStore.setState({ currentProject: sampleProject });

    mockInvoke.mockResolvedValueOnce(undefined); // close_project_cmd

    await useProjectStore.getState().closeProject();

    const state = useProjectStore.getState();
    expect(state.currentProject).toBeNull();
  });

  it('closeProject 应调用 close_project_cmd', async () => {
    useProjectStore.setState({ currentProject: sampleProject });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useProjectStore.getState().closeProject();

    expect(mockInvoke).toHaveBeenCalledWith('close_project_cmd');
  });
});

describe('projectStore - loadRecentProjects', () => {
  it('loadRecentProjects 应从后端加载列表', async () => {
    mockInvoke.mockResolvedValueOnce([sampleProject, anotherProject]);

    await useProjectStore.getState().loadRecentProjects();

    const state = useProjectStore.getState();
    expect(state.recentProjects).toHaveLength(2);
    expect(state.recentProjects[0].name).toBe('ghostterm');
  });

  it('loadRecentProjects 应调用 list_recent_projects_cmd', async () => {
    mockInvoke.mockResolvedValueOnce([]);

    await useProjectStore.getState().loadRecentProjects();

    expect(mockInvoke).toHaveBeenCalledWith('list_recent_projects_cmd');
  });
});

// ============================================
// PBI-6.4: openProject 协调链路测试
// openProject 是 PBI-6 新增的完整协调入口，区别于旧的 switchProject
// ============================================

// mock 动态 import 路径，拦截 openProject 内部的 lazy import
// vitest 的 vi.mock 会被 hoist 到文件顶部，确保在 import 前生效
const mockRefreshFileTree = vi.fn().mockResolvedValue(undefined);
const mockRefreshGitStatus = vi.fn().mockResolvedValue(undefined);
const mockRefreshWorktrees = vi.fn().mockResolvedValue(undefined);
const mockCloseAll = vi.fn();

vi.mock('../fileTreeStore', () => ({
  useFileTreeStore: {
    getState: () => ({ refreshFileTree: mockRefreshFileTree }),
  },
}));

vi.mock('../gitStore', () => ({
  useGitStore: {
    getState: () => ({
      refreshGitStatus: mockRefreshGitStatus,
      refreshWorktrees: mockRefreshWorktrees,
    }),
  },
}));

vi.mock('../../editor/editorStore', () => ({
  useEditorStore: {
    getState: () => ({ closeAll: mockCloseAll }),
  },
}));

describe('projectStore - openProject（PBI-6.4 协调链路）', () => {
  beforeEach(() => {
    // 重置所有 mock 函数调用记录
    mockRefreshFileTree.mockClear();
    mockRefreshGitStatus.mockClear();
    mockRefreshWorktrees.mockClear();
    mockCloseAll.mockClear();
  });

  it('openProject 应更新 currentProject', async () => {
    // open_project_cmd 返回项目信息，list_recent_projects_cmd 返回列表
    mockInvoke
      .mockResolvedValueOnce(sampleProject)   // open_project_cmd
      .mockResolvedValueOnce([sampleProject]); // list_recent_projects_cmd（loadRecentProjects 调用）

    await useProjectStore.getState().openProject('/Users/test/ghostterm');

    const state = useProjectStore.getState();
    expect(state.currentProject).toEqual(sampleProject);
  });

  it('openProject 应以新项目路径调用 refreshFileTree', async () => {
    mockInvoke
      .mockResolvedValueOnce(sampleProject)
      .mockResolvedValueOnce([sampleProject]);

    await useProjectStore.getState().openProject('/Users/test/ghostterm');

    // fileTreeStore.refreshFileTree 应传入项目路径
    expect(mockRefreshFileTree).toHaveBeenCalledWith('/Users/test/ghostterm');
  });

  it('openProject 应并行调用 refreshGitStatus 和 refreshWorktrees', async () => {
    mockInvoke
      .mockResolvedValueOnce(sampleProject)
      .mockResolvedValueOnce([sampleProject]);

    await useProjectStore.getState().openProject('/Users/test/ghostterm');

    // 两者均应以项目路径调用
    expect(mockRefreshGitStatus).toHaveBeenCalledWith('/Users/test/ghostterm');
    expect(mockRefreshWorktrees).toHaveBeenCalledWith('/Users/test/ghostterm');
  });

  it('openProject 应调用 editorStore.closeAll 清除旧文件', async () => {
    mockInvoke
      .mockResolvedValueOnce(sampleProject)
      .mockResolvedValueOnce([sampleProject]);

    await useProjectStore.getState().openProject('/Users/test/ghostterm');

    // 切换项目时应关闭所有已打开的编辑器文件
    expect(mockCloseAll).toHaveBeenCalledTimes(1);
  });

  it('openProject 应刷新 recentProjects', async () => {
    mockInvoke
      .mockResolvedValueOnce(sampleProject)
      .mockResolvedValueOnce([sampleProject, anotherProject]); // loadRecentProjects 返回

    await useProjectStore.getState().openProject('/Users/test/ghostterm');

    const state = useProjectStore.getState();
    expect(state.recentProjects).toHaveLength(2);
  });
});
