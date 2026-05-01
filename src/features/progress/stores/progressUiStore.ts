/**
 * @file progressUiStore.ts
 * @description 进度模块 UI 状态：当前视图 / 选中项目 / 上次视图（用于详情返回）/ 状态过滤
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { create } from 'zustand';

export type ProgressView = 'kanban' | 'list' | 'gantt' | 'notifications' | 'earnings';
export type ProjectStatusFilter = 'all' | 'dealing' | 'quoting' | 'developing' | 'confirming' | 'delivered' | 'paid' | 'archived' | 'after_sales' | 'cancelled';

interface ProgressUiState {
  currentView: ProgressView;
  selectedProjectId: number | null;
  priorView: ProgressView | null;
  statusFilter: ProjectStatusFilter;
  searchQuery: string;

  setCurrentView: (v: ProgressView) => void;
  setStatusFilter: (f: ProjectStatusFilter) => void;
  setSearchQuery: (q: string) => void;
  openProjectFromView: (id: number, fromView: ProgressView) => void;
  closeProject: () => void;
}

export const useProgressUiStore = create<ProgressUiState>((set) => ({
  currentView: 'kanban',
  selectedProjectId: null,
  priorView: null,
  statusFilter: 'all',
  searchQuery: '',

  setCurrentView: (v) => set({ currentView: v }),
  setStatusFilter: (f) => set({ statusFilter: f }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  openProjectFromView: (id, fromView) => set({ selectedProjectId: id, priorView: fromView }),
  closeProject: () => set({ selectedProjectId: null, priorView: null }),
}));
