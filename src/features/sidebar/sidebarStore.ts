/**
 * @file sidebarStore.ts
 * @description 侧边栏 UI 状态管理 - 控制当前激活标签页和侧边栏显示/隐藏状态。
 *              不涉及业务数据，只管理 UI 交互状态。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { create } from 'zustand';

/** 侧边栏支持的三个标签页 */
export type SidebarTab = 'files' | 'changes' | 'worktrees';

/** 侧边栏 UI 状态 */
interface SidebarState {
  /** 当前激活的标签页 */
  activeTab: SidebarTab;
  /** 侧边栏是否可见（Cmd+B 控制） */
  visible: boolean;
  /** 切换激活标签页 */
  setTab: (tab: SidebarTab) => void;
  /** 切换侧边栏显示/隐藏 */
  toggleVisibility: () => void;
}

export const useSidebarStore = create<SidebarState>((set) => ({
  // 默认显示 files 标签页，侧边栏默认可见
  activeTab: 'files',
  visible: true,

  setTab: (tab) => set({ activeTab: tab }),

  toggleVisibility: () => set((state) => ({ visible: !state.visible })),
}));
