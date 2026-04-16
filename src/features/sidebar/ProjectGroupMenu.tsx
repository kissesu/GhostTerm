import { Plus, Check } from 'lucide-react';
import ProjectGroupIcon from './ProjectGroupIcon';
import type { VisibleProjectGroup } from './projectGroupingStore';

interface ProjectGroupMenuProps {
  groups: VisibleProjectGroup[];
  selectedGroupId: string;
  onSelectGroup: (groupId: string) => void;
  onCreateGroup: () => void;
}

export default function ProjectGroupMenu({
  groups,
  selectedGroupId,
  onSelectGroup,
  onCreateGroup,
}: ProjectGroupMenuProps) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 54,
        left: 8,
        right: 8,
        zIndex: 40,
        background: 'var(--c-overlay)',
        border: '1px solid var(--c-border)',
        borderRadius: 10,
        padding: '4px 0',
        boxShadow: 'var(--shadow-lg)',
      }}
      data-testid="project-group-menu"
    >
      {groups.map((group) => {
        const active = selectedGroupId === group.id;
        return (
          <button
            key={group.id}
            type="button"
            onClick={() => onSelectGroup(group.id)}
            style={{
              width: '100%',
              border: 'none',
              background: active ? 'var(--c-active)' : 'transparent',
              color: 'var(--c-fg)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 12px',
              cursor: 'pointer',
              fontSize: 13,
              fontFamily: 'var(--font-ui)',
              transition: 'background var(--dur-fast) var(--ease-out)',
            }}
            aria-label={`切换到${group.name}`}
            onMouseEnter={(e) => {
              if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'var(--c-hover)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = active ? 'var(--c-active)' : 'transparent';
            }}
          >
            {/* 分组类型图标 */}
            <span style={{ flexShrink: 0, color: 'var(--c-fg-muted)', display: 'flex' }}>
              <ProjectGroupIcon icon={group.icon} size={13} color="currentColor" />
            </span>
            {/* 颜色标记点 */}
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: group.color,
                flexShrink: 0,
              }}
            />
            {/* 分组名称 */}
            <span style={{ flex: 1, minWidth: 0, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {group.name}
            </span>
            {/* 项目数 */}
            <span style={{ fontSize: 11, color: 'var(--c-fg-subtle)', fontVariantNumeric: 'tabular-nums' }}>
              {group.projectCount}
            </span>
            {/* 选中勾 */}
            <span style={{ width: 14, display: 'flex', justifyContent: 'center', color: 'var(--c-accent)', flexShrink: 0 }}>
              {active && <Check size={12} strokeWidth={2.5} />}
            </span>
          </button>
        );
      })}

      {/* 新建分组 */}
      <div style={{ borderTop: '1px solid var(--c-border-sub)', margin: '4px 0 0' }}>
        <button
          type="button"
          onClick={onCreateGroup}
          style={{
            width: '100%',
            border: 'none',
            background: 'transparent',
            color: 'var(--c-fg-muted)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 12px',
            cursor: 'pointer',
            fontSize: 13,
            fontFamily: 'var(--font-ui)',
            transition: 'background var(--dur-fast) var(--ease-out)',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--c-hover)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
        >
          <Plus size={13} strokeWidth={2} />
          <span>新建分组</span>
        </button>
      </div>
    </div>
  );
}
