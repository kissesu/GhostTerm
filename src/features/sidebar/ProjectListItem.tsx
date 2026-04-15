/**
 * @file ProjectListItem.tsx
 * @description 项目列表单项组件 - 展示单个项目卡片，活跃项目时向下展开 Files/Changes/Worktrees 手风琴区域。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { useEffect, useRef } from 'react';
import { FolderCode, SlidersHorizontal } from 'lucide-react';
import type { ProjectInfo } from '../../shared/types';
import Changes from './Changes';
import FileTree from './FileTree';
import ProjectGroupIcon from './ProjectGroupIcon';
import Worktrees from './Worktrees';
import type { VisibleProjectGroup } from './projectGroupingStore';
import { useSidebarStore, type SidebarTab } from './sidebarStore';

interface ProjectListItemProps {
  project: ProjectInfo;
  active: boolean;
  /** 手风琴面板是否收起（点击当前项目名可切换） */
  collapsed: boolean;
  onSelect: (path: string) => void;
  onRemove: (projectPath: string) => void;
  groups: VisibleProjectGroup[];
  currentGroupId: string;
  menuOpen: boolean;
  onToggleMenu: (projectPath: string) => void;
  onAssignGroup: (projectPath: string, groupId: string) => void;
}

// 手风琴中的标签页定义，key 与 SidebarTab 类型一一对应
const TABS: { key: SidebarTab; label: string }[] = [
  { key: 'files', label: 'Files' },
  { key: 'changes', label: 'Changes' },
  { key: 'worktrees', label: 'Worktrees' },
];

function shortenPath(fullPath: string) {
  const homePrefix = '/Users/';
  if (!fullPath.startsWith(homePrefix)) return fullPath;
  const segments = fullPath.split('/').filter(Boolean);
  if (segments.length < 3) return fullPath;
  return `.../${segments.slice(2).join('/')}`;
}

export default function ProjectListItem({
  project,
  active,
  collapsed,
  onSelect,
  onRemove,
  groups,
  currentGroupId,
  menuOpen,
  onToggleMenu,
  onAssignGroup,
}: ProjectListItemProps) {
  // 从全局侧边栏 store 获取当前激活标签和切换方法
  const { activeTab, setTab } = useSidebarStore();
  const itemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!itemRef.current?.contains(event.target as Node)) {
        onToggleMenu(project.path);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onToggleMenu(project.path);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen, onToggleMenu, project.path]);

  return (
    <div
      ref={itemRef}
      style={{
        position: 'relative',
      }}
    >
      {/* 项目卡片：活跃时只保留上圆角，下圆角由手风琴区域接管 */}
      <div
        data-testid={`project-card-${project.name}`}
        data-active={active ? 'true' : 'false'}
        style={{
          width: '100%',
          border: 'none',
          borderRadius: active ? '18px 18px 0 0' : 18,
          background: active ? '#414868' : '#2b2e43',
          color: '#eef0ff',
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          boxShadow: active
            ? '0 0 0 1px rgba(122,162,247,0.38), 0 14px 30px rgba(15,17,26,0.32)'
            : 'none',
        }}
      >
        <button
          type="button"
          onClick={() => onSelect(project.path)}
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            padding: 0,
            textAlign: 'left',
            cursor: 'pointer',
          }}
          aria-label={`打开项目 ${project.name}`}
        >
          <span style={{ color: '#d4d8f5', marginTop: 2 }}>
            <FolderCode size={20} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span
              style={{
                display: 'block',
                fontSize: 16,
                fontWeight: 700,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {project.name}
            </span>
            <span
              style={{
                display: 'block',
                marginTop: 6,
                fontSize: 12,
                color: '#a0a5be',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {shortenPath(project.path)}
            </span>
          </span>
        </button>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            color: '#c7cadb',
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            aria-label={`管理项目 ${project.name}`}
            onClick={() => onToggleMenu(project.path)}
            style={{
              width: 28,
              height: 28,
              border: 'none',
              borderRadius: 999,
              background: menuOpen ? '#464c69' : 'transparent',
              color: '#c7cadb',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <SlidersHorizontal size={16} />
          </button>
        </span>
      </div>

      {/* 手风琴展开区域：仅活跃且未收起时展示，包含 Files/Changes/Worktrees 标签页 */}
      {active && !collapsed && (
        <div
          data-testid={`accordion-panel-${project.name}`}
          style={{
            background: '#1e2030',
            borderRadius: '0 0 18px 18px',
            overflow: 'hidden',
          }}
        >
          {/* 标签页导航栏 */}
          <div
            role="tablist"
            style={{
              display: 'flex',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={activeTab === key}
                onClick={() => setTab(key)}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  background: 'transparent',
                  border: 'none',
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

          {/* 标签页内容区域：高度自然增长，由外部侧边栏滚动容器统一管理滚动 */}
          <div>
            {activeTab === 'files' && <FileTree />}
            {activeTab === 'changes' && <Changes />}
            {activeTab === 'worktrees' && <Worktrees />}
          </div>
        </div>
      )}

      {/* 分组菜单浮层 */}
      {menuOpen && (
        <div
          role="menu"
          aria-label={`${project.name} 分组菜单`}
          style={{
            position: 'absolute',
            top: 62,
            right: 10,
            zIndex: 20,
            minWidth: 188,
            borderRadius: 14,
            border: '1px solid #4b4f67',
            background: '#26293d',
            boxShadow: '0 12px 24px rgba(0,0,0,0.26)',
            overflow: 'hidden',
          }}
        >
          {groups
            .filter((group) => group.id !== 'all')
            .map((group, index) => (
              <button
                key={group.id}
                type="button"
                role="menuitem"
                aria-label={`移动到分组 ${group.name}`}
                onClick={() => onAssignGroup(project.path, group.id)}
                style={{
                  width: '100%',
                  border: 'none',
                  borderTop: index === 0 ? 'none' : '1px solid rgba(255,255,255,0.05)',
                  background: 'transparent',
                  color: '#eef0ff',
                  padding: '11px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <ProjectGroupIcon icon={group.icon} size={16} color="#eef0ff" />
                <span style={{ flex: 1, minWidth: 0 }}>{group.name}</span>
                <span style={{ color: currentGroupId === group.id ? '#8fc2ff' : '#6f748f' }}>
                  {currentGroupId === group.id ? '当前' : ''}
                </span>
              </button>
            ))}
          {/* 从面板移除：只删除记录，不删除本地文件 */}
          <button
            type="button"
            role="menuitem"
            aria-label={`从面板移除项目 ${project.name}`}
            onClick={() => onRemove(project.path)}
            style={{
              width: '100%',
              border: 'none',
              borderTop: '1px solid rgba(255,255,255,0.05)',
              background: 'transparent',
              color: '#f29ba1',
              padding: '11px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>从面板移除</span>
          </button>
        </div>
      )}
    </div>
  );
}
