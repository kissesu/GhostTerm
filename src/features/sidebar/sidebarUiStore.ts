/**
 * @file sidebarUiStore.ts
 * @description 侧边栏局部 UI 状态管理：统一控制“添加项目”对话框的打开/关闭和默认分组。
 */

import { create } from 'zustand';

interface SidebarUiState {
  addProjectDialogOpen: boolean;
  addProjectDialogGroupId?: string;
  openAddProjectDialog: (groupId?: string) => void;
  closeAddProjectDialog: () => void;
}

export const useSidebarUiStore = create<SidebarUiState>((set) => ({
  addProjectDialogOpen: false,
  addProjectDialogGroupId: undefined,
  openAddProjectDialog: (groupId) => {
    set({
      addProjectDialogOpen: true,
      addProjectDialogGroupId: groupId,
    });
  },
  closeAddProjectDialog: () => {
    set({
      addProjectDialogOpen: false,
      addProjectDialogGroupId: undefined,
    });
  },
}));
