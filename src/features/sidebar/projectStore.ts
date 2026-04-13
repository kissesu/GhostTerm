/**
 * @file projectStore.ts
 * @description 项目状态管理 - 管理当前项目和最近项目列表。
 *              通过 Tauri invoke 调用后端 project_manager 模块进行项目切换和持久化。
 *              PBI-6：openProject 协调所有子系统（fileTree/git/editor）完成完整切换链路。
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
  /**
   * 完整打开项目（PBI-6 协调入口）
   * 协调 fileTree / git / editor 各子系统完成切换
   */
  openProject: (path: string) => Promise<void>;
  /** 切换到指定路径的项目（兼容旧接口，内部调用 openProject） */
  switchProject: (path: string) => Promise<void>;
  /** 关闭当前项目 */
  closeProject: () => Promise<void>;
  /** 从后端加载最近项目列表 */
  loadRecentProjects: () => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  currentProject: null,
  recentProjects: [],

  /**
   * 完整打开项目（PBI-6 协调链路）
   *
   * 业务逻辑：
   * 1. 调用后端 open_project_cmd（内部已协调 watcher stop旧 + start新）
   * 2. 更新当前项目状态
   * 3. 刷新文件树（重新加载根目录，清空旧项目展开状态）
   * 4. 并行刷新 git 状态和 worktree 列表
   * 5. 关闭所有编辑器文件（切换项目不保留旧文件）
   * 6. 刷新最近项目列表（后端已将新项目插入头部）
   *
   * 延迟导入（lazy import）避免循环依赖：
   * sidebar/projectStore → editor/editorStore 存在模块间依赖，
   * 在函数体内动态 import 确保各模块独立初始化后再建立依赖关系
   */
  openProject: async (path: string) => {
    // ============================================
    // 第一步：通知后端打开项目（协调 watcher）
    // ============================================
    const project = await invoke<ProjectInfo>('open_project_cmd', { path });
    set({ currentProject: project });

    // ============================================
    // 第二步：刷新文件树（重置为新项目根目录）
    // ============================================
    const { useFileTreeStore } = await import('./fileTreeStore');
    await useFileTreeStore.getState().refreshFileTree(path);

    // ============================================
    // 第三步：并行刷新 git 状态 + worktree 列表
    // 两者独立，可并行执行缩短等待时间
    // ============================================
    const { useGitStore } = await import('./gitStore');
    await Promise.all([
      useGitStore.getState().refreshGitStatus(path),
      useGitStore.getState().refreshWorktrees(path),
    ]);

    // ============================================
    // 第四步：关闭所有编辑器文件（旧项目文件不应出现在新项目中）
    // ============================================
    const { useEditorStore } = await import('../editor/editorStore');
    useEditorStore.getState().closeAll();

    // ============================================
    // 第五步：刷新最近项目列表（后端已更新排序）
    // ============================================
    await get().loadRecentProjects();
  },

  /**
   * 切换到指定路径的项目（兼容旧接口）
   *
   * 业务逻辑：
   * 1. 调用后端 open_project_cmd，获取项目信息并更新内存状态
   * 2. 再调用 list_recent_projects_cmd 刷新最近项目列表（后端已更新排序）
   *
   * 注意：此方法保留以兼容现有测试，新代码请使用 openProject
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
   * 1. 调用后端 close_project_cmd 清理服务端状态（含 watcher 停止）
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
