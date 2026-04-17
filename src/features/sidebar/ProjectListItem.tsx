/**
 * @file ProjectListItem.tsx - 项目列表单项组件
 * @description 展示单个项目卡片，活跃项目时向下展开 Files/Changes/Worktrees 手风琴区域。
 *              重设计：去掉"左侧粗边框"反模式（skill DON'T），改用暖色背景 tint + 全边框。
 * @author Atlas.oi
 * @date 2026-04-15
 */

import { useEffect, useRef } from 'react';
import { FolderCode, SlidersHorizontal, Search } from 'lucide-react';
import { useSearchStore } from '../search';
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
  collapsed: boolean;
  onSelect: (path: string) => void;
  onRemove: (projectPath: string) => void;
  groups: VisibleProjectGroup[];
  currentGroupId: string;
  menuOpen: boolean;
  onToggleMenu: (projectPath: string) => void;
  onAssignGroup: (projectPath: string, groupId: string) => void;
}

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
  const { activeTab, setTab } = useSidebarStore();
  const itemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!itemRef.current?.contains(event.target as Node)) onToggleMenu(project.path);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onToggleMenu(project.path);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen, onToggleMenu, project.path]);

  return (
    <div ref={itemRef} style={{ position: 'relative', padding: '0 8px 5px' }}>
      {/* =========================================
          项目卡片
          活跃状态：暖色 tint 背景 + accent 全边框（替代旧的左侧粗边框反模式）
          非活跃状态：raised 背景，无边框，视觉上轻盈
          ========================================= */}
      <div
        data-testid={`project-card-${project.name}`}
        data-active={active ? 'true' : 'false'}
        style={{
          width: '100%',
          borderRadius: active ? 'var(--r-md) var(--r-md) 0 0' : 'var(--r-md)',
          border: active
            ? '1px solid var(--c-accent-dim)'
            : '1px solid transparent',
          background: active ? 'var(--c-card-active)' : 'transparent',
          color: 'var(--c-fg)',
          padding: '9px 10px 9px 12px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 9,
          transition: 'border-color var(--dur-base) var(--ease-out), background var(--dur-base) var(--ease-out)',
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
            gap: 9,
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            padding: 0,
            textAlign: 'left',
            cursor: 'pointer',
          }}
          aria-label={`打开项目 ${project.name}`}
        >
          {/* 文件夹图标 — 活跃时用 accent 色 */}
          <span style={{
            color: active ? 'var(--c-accent)' : 'var(--c-fg-subtle)',
            marginTop: 2,
            flexShrink: 0,
            transition: 'color var(--dur-base) var(--ease-out)',
          }}>
            <FolderCode size={16} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{
              display: 'block',
              fontSize: 13,
              fontWeight: active ? 600 : 500,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              color: active ? 'var(--c-fg)' : 'var(--c-fg-muted)',
              transition: 'color var(--dur-base) var(--ease-out)',
            }}>
              {project.name}
            </span>
            <span style={{
              display: 'block',
              marginTop: 2,
              fontSize: 11,
              color: 'var(--c-fg-subtle)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              letterSpacing: '0.01em',
            }}>
              {shortenPath(project.path)}
            </span>
          </span>
        </button>

        {/* 搜索按钮：仅活跃项目显示，点击打开项目内全文搜索弹窗 */}
        {active && (
          <button
            type="button"
            aria-label={`搜索项目 ${project.name}`}
            onClick={(e) => {
              e.stopPropagation();
              useSearchStore.getState().open(project.path);
            }}
            className="btn-icon"
            style={{ width: 24, height: 24, background: 'transparent' }}
          >
            <Search size={12} />
          </button>
        )}

        {/* 分组管理按钮 */}
        <button
          type="button"
          aria-label={`管理项目 ${project.name}`}
          onClick={() => onToggleMenu(project.path)}
          className="btn-icon"
          style={{
            width: 24, height: 24,
            background: menuOpen ? 'var(--c-active)' : 'transparent',
            color: menuOpen ? 'var(--c-fg)' : undefined,
          }}
        >
          <SlidersHorizontal size={12} />
        </button>
      </div>

      {/* =========================================
          手风琴展开区域
          ========================================= */}
      {active && !collapsed && (
        <div
          data-testid={`accordion-panel-${project.name}`}
          style={{
            background: 'var(--c-bg)',
            borderRadius: '0 0 var(--r-md) var(--r-md)',
            border: '1px solid var(--c-accent-dim)',
            borderTop: 'none',
            overflow: 'hidden',
          }}
        >
          {/* 标签页导航 */}
          <div
            role="tablist"
            style={{
              display: 'flex',
              borderBottom: '1px solid var(--c-border-sub)',
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
                  borderBottom: activeTab === key
                    ? '2px solid var(--c-accent)'
                    : '2px solid transparent',
                  cursor: 'pointer',
                  color: activeTab === key ? 'var(--c-fg)' : 'var(--c-fg-subtle)',
                  fontSize: 11,
                  fontWeight: activeTab === key ? 600 : 400,
                  letterSpacing: '0.02em',
                  fontFamily: 'var(--font-ui)',
                  transition: 'color var(--dur-fast) var(--ease-out), border-bottom-color var(--dur-fast) var(--ease-out)',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div>
            {activeTab === 'files'     && <FileTree />}
            {activeTab === 'changes'   && <Changes />}
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
            top: 46,
            right: 18,
            zIndex: 20,
            minWidth: 188,
            borderRadius: 'var(--r-lg)',
            border: '1px solid var(--c-border)',
            background: 'var(--c-overlay)',
            boxShadow: 'var(--shadow-menu)',
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
                  borderTop: index === 0 ? 'none' : '1px solid var(--c-border-sub)',
                  background: 'transparent',
                  color: 'var(--c-fg)',
                  padding: '9px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontFamily: 'var(--font-ui)',
                  transition: 'background var(--dur-fast) var(--ease-out)',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--c-hover)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              >
                <ProjectGroupIcon icon={group.icon} size={13} color="var(--c-fg-muted)" />
                <span style={{ flex: 1, minWidth: 0 }}>{group.name}</span>
                {currentGroupId === group.id && (
                  <span style={{ fontSize: 11, color: 'var(--c-accent)', fontWeight: 700 }}>当前</span>
                )}
              </button>
            ))}
          <button
            type="button"
            role="menuitem"
            aria-label={`从面板移除项目 ${project.name}`}
            onClick={() => onRemove(project.path)}
            style={{
              width: '100%',
              border: 'none',
              borderTop: '1px solid var(--c-border-sub)',
              background: 'transparent',
              color: 'var(--c-danger)',
              padding: '9px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              textAlign: 'left',
              cursor: 'pointer',
              fontSize: 12,
              fontFamily: 'var(--font-ui)',
              transition: 'background var(--dur-fast) var(--ease-out)',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--c-danger-dim)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>从面板移除</span>
          </button>
        </div>
      )}
    </div>
  );
}
