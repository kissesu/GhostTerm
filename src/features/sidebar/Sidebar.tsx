/**
 * @file Sidebar.tsx
 * @description 侧边栏根组件 - 项目选择器（含手风琴式详情）+ 底部添加项目按钮。
 *              Files/Changes/Worktrees 标签页已移入 ProjectListItem 的手风琴展开区。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import ProjectSelector from './ProjectSelector';
import AddProjectButton from './AddProjectButton';

/** 侧边栏根组件 */
export default function Sidebar() {
  return (
    <div
      style={{
        height: '100%',
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#16161e',
        overflow: 'hidden',
      }}
      data-testid="sidebar-root"
    >
      {/* 项目选择器（含手风琴式 Files/Changes/Worktrees）— flex:1 让其占满剩余空间 */}
      <ProjectSelector />

      {/* 底部固定：添加项目按钮 */}
      <AddProjectButton />
    </div>
  );
}
