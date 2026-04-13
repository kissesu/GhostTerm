/**
 * @file projectStore.ts
 * @description 项目状态管理 - 管理当前项目和最近项目列表。
 *              通过 Tauri invoke 调用后端 project_manager 模块进行项目切换和持久化。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { ProjectInfo } from '../../shared/types';

/** 项目状态 */
interface ProjectState {
  /** 当前打开的项目，未打开时为 null */
  currentProject: ProjectInfo | null;
  /** 最近打开的项目列表（按 last_opened 降序） */
  recentProjects: ProjectInfo[];
  /** 切换到指定路径的项目 */
  switchProject: (path: string) => Promise<void>;
  /** 关闭当前项目 */
  closeProject: () => Promise<void>;
  /** 从后端加载最近项目列表 */
  loadRecentProjects: () => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set) => ({
  currentProject: null,
  recentProjects: [],

  /**
   * 切换到指定路径的项目
   *
   * 业务逻辑：
   * 1. 调用后端 open_project_cmd，获取项目信息并更新内存状态
   * 2. 再调用 list_recent_projects_cmd 刷新最近项目列表（后端已更新排序）
   */
  switchProject: async (path: string) => {
    const project = await invoke<ProjectInfo>('open_project_cmd', { path });
    set({ currentProject: project });

    // 刷新最近项目列表（后端已将新项目插入头部）
    const recentProjects = await invoke<ProjectInfo[]>('list_recent_projects_cmd');
    set({ recentProjects });
  },

  /**
   * 关闭当前项目
   *
   * 业务逻辑：
   * 1. 调用后端 close_project_cmd 清理服务端状态
   * 2. 清空前端 currentProject
   */
  closeProject: async () => {
    await invoke('close_project_cmd');
    set({ currentProject: null });
  },

  /**
   * 从后端加载最近项目列表
   * 用于应用启动时初始化，或需要手动刷新时调用
   */
  loadRecentProjects: async () => {
    const recentProjects = await invoke<ProjectInfo[]>('list_recent_projects_cmd');
    set({ recentProjects });
  },
}));
