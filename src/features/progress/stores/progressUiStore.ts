/**
 * @file progressUiStore.ts
 * @description 进度模块纯 UI 状态 store（Phase 10）。
 *
 *              业务背景（user 偏好：feedback_ui_state_in_component）：
 *              - 大多数 UI 局部状态留在组件内（useState）
 *              - 但跨组件共享的"视图切换 / 筛选 / 当前选中详情"必须共享，否则父子层层 props 透传
 *
 *              本 store 仅持有 UI 状态：
 *              - currentView：当前视图（list / kanban）
 *              - searchQuery：toolbar 搜索框文本
 *              - statusFilter：状态过滤；"all" = 不过滤
 *              - selectedProjectId：详情页打开的项目 id；null = 列表/看板视图
 *
 *              不做的事：
 *              - 不持久化（localStorage）：每次进入 Progress tab 都从初始态开始
 *                理由：v1 业务量不大，刷新后回到列表是合理预期
 *              - 不做"上次打开的项目自动恢复"：避免误导用户以为还在编辑
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { create } from 'zustand';

import type { ProjectStatus } from '../api/projects';

/** 当前视图模式 */
export type ProgressView = 'list' | 'kanban';

/** 状态过滤值；"all" 表示不过滤 */
export type StatusFilter = ProjectStatus | 'all';

interface ProgressUiState {
  // ============ 视图切换 ============
  currentView: ProgressView;
  setCurrentView: (view: ProgressView) => void;

  // ============ 搜索（仅前端 contains 过滤；不发请求） ============
  searchQuery: string;
  setSearchQuery: (q: string) => void;

  // ============ 状态过滤 ============
  statusFilter: StatusFilter;
  setStatusFilter: (status: StatusFilter) => void;

  // ============ 详情页选中 ============
  /**
   * 当前打开的项目 id。
   * - null = 列表 / 看板视图
   * - number = 详情页（ProgressShell 据此分支渲染）
   */
  selectedProjectId: number | null;
  setSelectedProject: (id: number | null) => void;

  // ============ 重置（登出 / 切换账号） ============
  reset: () => void;
}

export const useProgressUiStore = create<ProgressUiState>((set) => ({
  currentView: 'list',
  setCurrentView: (view) => set({ currentView: view }),

  searchQuery: '',
  setSearchQuery: (q) => set({ searchQuery: q }),

  statusFilter: 'all',
  setStatusFilter: (status) => set({ statusFilter: status }),

  selectedProjectId: null,
  setSelectedProject: (id) => set({ selectedProjectId: id }),

  reset: () =>
    set({
      currentView: 'list',
      searchQuery: '',
      statusFilter: 'all',
      selectedProjectId: null,
    }),
}));
