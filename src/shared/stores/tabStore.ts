/**
 * @file tabStore.ts
 * @description 标题栏三分区 Tab 状态管理。activeTab: project | tools | progress。
 *              不持久化 localStorage，每次启动默认回 'project'。
 * @author Atlas.oi
 * @date 2026-04-17
 */
import { create } from 'zustand';

export type Tab = 'project' | 'tools' | 'progress';

interface TabState {
  activeTab: Tab;
  setActive: (tab: Tab) => void;
}

export const useTabStore = create<TabState>((set) => ({
  activeTab: 'project',
  setActive: (tab) => set({ activeTab: tab }),
}));
