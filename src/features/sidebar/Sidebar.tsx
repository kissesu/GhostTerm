/**
 * @file Sidebar.tsx
 * @description 侧边栏根组件 - 包含项目选择器和三标签页（Files/Changes/Worktrees）。
 *              标签页切换使用底线指示器样式（Linear/Supremum 风格）。
 *              Changes 和 Worktrees 面板在 PBI-5 实现，当前显示占位。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import ProjectSelector from './ProjectSelector';
import FileTree from './FileTree';
import Changes from './Changes';
import Worktrees from './Worktrees';
import { useSidebarStore, type SidebarTab } from './sidebarStore';

/** 标签页定义 */
const TABS: { key: SidebarTab; label: string }[] = [
  { key: 'files', label: 'Files' },
  { key: 'changes', label: 'Changes' },
  { key: 'worktrees', label: 'Worktrees' },
];

/** 侧边栏根组件 */
export default function Sidebar() {
  const { activeTab, setTab } = useSidebarStore();

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
      {/* 顶部：项目选择器 */}
      <ProjectSelector />

      {/* 标签页导航 - Linear/Supremum 底线指示器风格 */}
      <div
        role="tablist"
        aria-label="侧边栏标签页"
        style={{
          display: 'flex',
          borderBottom: '1px solid #27293d',
          flexShrink: 0,
        }}
      >
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            role="tab"
            aria-selected={activeTab === key}
            aria-controls={`sidebar-panel-${key}`}
            id={`sidebar-tab-${key}`}
            onClick={() => setTab(key)}
            style={{
              flex: 1,
              padding: '6px 0',
              background: 'transparent',
              border: 'none',
              // 底线指示器：active 标签下方蓝色 2px 下划线
              borderBottom: activeTab === key ? '2px solid #7aa2f7' : '2px solid transparent',
              cursor: 'pointer',
              color: activeTab === key ? '#c0caf5' : '#565f89',
              fontSize: 11,
              fontWeight: activeTab === key ? 600 : 400,
              transition: 'color 0.15s, border-bottom-color 0.15s',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 标签页内容区 — minHeight: 0 允许 flex 收缩，防止内容撑开父容器 */}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
        {/* Files 面板 */}
        <div
          role="tabpanel"
          id="sidebar-panel-files"
          aria-labelledby="sidebar-tab-files"
          data-testid="panel-files"
          hidden={activeTab !== 'files'}
          style={{ height: '100%', minWidth: 0, minHeight: 0 }}
        >
          <FileTree />
        </div>

        {/* Changes 面板 */}
        <div
          role="tabpanel"
          id="sidebar-panel-changes"
          aria-labelledby="sidebar-tab-changes"
          data-testid="panel-changes"
          hidden={activeTab !== 'changes'}
          style={{ height: '100%', minWidth: 0, minHeight: 0 }}
        >
          <Changes />
        </div>

        {/* Worktrees 面板 */}
        <div
          role="tabpanel"
          id="sidebar-panel-worktrees"
          aria-labelledby="sidebar-tab-worktrees"
          data-testid="panel-worktrees"
          hidden={activeTab !== 'worktrees'}
          style={{ height: '100%', minWidth: 0, minHeight: 0 }}
        >
          <Worktrees />
        </div>
      </div>
    </div>
  );
}
