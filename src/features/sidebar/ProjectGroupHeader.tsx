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
        gap: 10,
        padding: '10px 12px',
        borderBottom: '1px solid #2a2d43',
        background: '#353952',
      }}
      data-testid="project-group-header"
    >
      <span
        style={{
          width: 24,
          height: 24,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <ProjectGroupIcon icon={currentGroup.icon} size={18} color="#eef0ff" />
      </span>
      <span
        style={{
          width: 12,
          height: 12,
          borderRadius: 999,
          background: currentGroup.color,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: '#f3f4ff',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          data-testid="project-group-label"
        >
          {currentGroup.name}
        </div>
      </div>
      <span
        style={{
          minWidth: 28,
          height: 28,
          padding: '0 10px',
          borderRadius: 999,
          background: '#4b4434',
          color: '#e8dcc1',
          fontSize: 13,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
        data-testid="project-group-count"
      >
        {currentGroup.projectCount}
      </span>
      <button
        type="button"
        onClick={onToggleMenu}
        style={{
          width: 28,
          height: 28,
          border: 'none',
          background: 'transparent',
          color: '#c0c3d7',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        aria-label="切换分组"
        data-testid="project-group-toggle"
      >
        <ChevronDown
          size={18}
          style={{
            transform: menuOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s',
          }}
        />
      </button>
      <button
        type="button"
        onClick={onToggleEditMenu}
        disabled={!canEdit}
        style={{
          width: 28,
          height: 28,
          border: 'none',
          background: 'transparent',
          color: canEdit ? '#c0c3d7' : '#727692',
          cursor: canEdit ? 'pointer' : 'not-allowed',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        aria-label="编辑分组"
      >
        <Pencil size={16} />
      </button>
    </div>
  );
}
