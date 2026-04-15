/**
 * @file features/sidebar/index.ts
 * @description 侧边栏模块公共导出 - 暴露组件和 Store 给外部使用
 * @author Atlas.oi
 * @date 2026-04-13
 */

export { default as Sidebar } from './Sidebar';
export { default as FileTree } from './FileTree';
export { default as ProjectSelector } from './ProjectSelector';
export { useProjectGroupingStore } from './projectGroupingStore';
export { default as Changes } from './Changes';
export { default as Worktrees } from './Worktrees';
export { useSidebarStore } from './sidebarStore';
export { useProjectStore } from './projectStore';
export { useFileTreeStore } from './fileTreeStore';
export { useGitStore } from './gitStore';
export { default as AddProjectButton } from './AddProjectButton';
export { default as AddProjectDialog } from './AddProjectDialog';
