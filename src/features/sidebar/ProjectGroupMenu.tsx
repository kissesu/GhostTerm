import { Plus } from 'lucide-react';
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
        background: '#26293d',
        border: '1px solid #4b4f67',
        borderRadius: 16,
        padding: '10px 0',
        boxShadow: '0 16px 32px rgba(0, 0, 0, 0.28)',
      }}
      data-testid="project-group-menu"
    >
      {groups.map((group, index) => (
        <button
          key={group.id}
          type="button"
          onClick={() => onSelectGroup(group.id)}
          style={{
            width: '100%',
            border: 'none',
            background: 'transparent',
            color: '#eef0ff',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            cursor: 'pointer',
            borderTop: index === 0 ? 'none' : '1px solid rgba(255,255,255,0.04)',
          }}
          aria-label={`切换到${group.name}`}
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
            <ProjectGroupIcon icon={group.icon} size={18} color="#eef0ff" />
          </span>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 999,
              background: group.color,
              flexShrink: 0,
            }}
          />
          <span style={{ flex: 1, minWidth: 0, textAlign: 'left', fontSize: 16 }}>{group.name}</span>
          <span style={{ fontSize: 15, color: '#b9bdd2' }}>{group.projectCount}</span>
          <span style={{ width: 18, textAlign: 'center', color: '#eef0ff' }}>
            {selectedGroupId === group.id ? '✓' : ''}
          </span>
        </button>
      ))}
      <div style={{ borderTop: '1px solid #434762', marginTop: 8, paddingTop: 8 }}>
        <button
          type="button"
          onClick={onCreateGroup}
          style={{
            width: '100%',
            border: 'none',
            background: 'transparent',
            color: '#d7d9e8',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 16px',
            cursor: 'pointer',
            fontSize: 16,
          }}
        >
          <Plus size={20} />
          <span>新建分组</span>
        </button>
      </div>
    </div>
  );
}
