/**
 * @file ProjectGroupHeader.tsx - 侧边栏分组标头
 * @description 显示当前选中分组名称、项目数量，提供切换和编辑分组入口。
 *              重设计：更宽松的 padding，更清晰的视觉层次。
 * @author Atlas.oi
 * @date 2026-04-15
 */

import { ChevronDown, Pencil } from 'lucide-react';
import ProjectGroupIcon from './ProjectGroupIcon';
import type { VisibleProjectGroup } from './projectGroupingStore';

interface ProjectGroupHeaderProps {
  currentGroup: VisibleProjectGroup;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onToggleEditMenu: () => void;
  canEdit: boolean;
}

export default function ProjectGroupHeader({
  currentGroup,
  menuOpen,
  onToggleMenu,
  onToggleEditMenu,
  canEdit,
}: ProjectGroupHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        padding: '9px 10px 9px 12px',
        borderBottom: '1px solid var(--c-border-sub)',
        background: 'var(--c-panel)',
      }}
      data-testid="project-group-header"
    >
      {/* 分组图标 */}
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        color: 'var(--c-fg-subtle)',
      }}>
        <ProjectGroupIcon icon={currentGroup.icon} size={14} color="currentColor" />
      </span>

      {/* 分组名称 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--c-fg)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            letterSpacing: '0.01em',
          }}
          data-testid="project-group-label"
        >
          {currentGroup.name}
        </div>
      </div>

      {/* 项目数量徽章 */}
      <span
        style={{
          height: 18,
          padding: '0 6px',
          borderRadius: 999,
          background: 'var(--c-accent-glow)',
          border: '1px solid var(--c-accent-dim)',
          color: 'var(--c-accent)',
          fontSize: 10,
          fontWeight: 700,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          letterSpacing: '0.02em',
        }}
        data-testid="project-group-count"
      >
        {currentGroup.projectCount}
      </span>

      {/* 切换分组按钮 */}
      <button
        type="button"
        onClick={onToggleMenu}
        className="btn-icon"
        style={{ width: 24, height: 24 }}
        aria-label="切换分组"
        data-testid="project-group-toggle"
      >
        <ChevronDown
          size={14}
          style={{
            transform: menuOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform var(--dur-base) var(--ease-out)',
          }}
        />
      </button>

      {/* 编辑分组按钮 */}
      {canEdit && (
        <button
          type="button"
          onClick={onToggleEditMenu}
          className="btn-icon"
          style={{ width: 24, height: 24 }}
          aria-label="编辑分组"
        >
          <Pencil size={12} />
        </button>
      )}
    </div>
  );
}
