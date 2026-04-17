/**
 * @file Sidebar.tsx
 * @description 侧边栏根组件 - 项目选择器（含手风琴式详情）+ 底部添加项目按钮。
 * @author Atlas.oi
 * @date 2026-04-15
 */

import ProjectSelector from './ProjectSelector';
import AddProjectButton from './AddProjectButton';

export default function Sidebar() {
  return (
    <div
      style={{
        height: '100%',
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--c-bg)',
        overflow: 'hidden',
      }}
      data-testid="sidebar-root"
    >
      <ProjectSelector />
      <AddProjectButton />
    </div>
  );
}
