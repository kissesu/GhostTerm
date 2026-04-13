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
