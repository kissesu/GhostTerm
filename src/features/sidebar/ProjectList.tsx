import type { ProjectInfo } from '../../shared/types';
import type { VisibleProjectGroup } from './projectGroupingStore';
import ProjectListItem from './ProjectListItem';

interface ProjectListProps {
  projects: ProjectInfo[];
  currentProjectPath?: string;
  /** 当前活跃项目的手风琴是否收起 */
  accordionCollapsed: boolean;
  onSelect: (path: string) => void;
  onRemove: (projectPath: string) => void;
  groups: VisibleProjectGroup[];
  projectGroupMap: Record<string, string>;
  openMenuProjectPath?: string;
  onToggleMenu: (projectPath: string) => void;
  onAssignGroup: (projectPath: string, groupId: string) => void;
}

export default function ProjectList({
  projects,
  currentProjectPath,
  accordionCollapsed,
  onSelect,
  onRemove,
  groups,
  projectGroupMap,
  openMenuProjectPath,
  onToggleMenu,
  onAssignGroup,
}: ProjectListProps) {
  if (projects.length === 0) {
    return (
      <div
        style={{
          padding: '12px 14px 16px',
          color: '#8e93ad',
          fontSize: 13,
        }}
      >
        当前分组暂无项目
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '0 12px 12px',
      }}
    >
      {projects.map((project) => (
        <ProjectListItem
          key={project.path}
          project={project}
          active={currentProjectPath === project.path}
          collapsed={currentProjectPath === project.path ? accordionCollapsed : false}
          onSelect={onSelect}
          onRemove={onRemove}
          groups={groups}
          currentGroupId={projectGroupMap[project.path] ?? 'ungrouped'}
          menuOpen={openMenuProjectPath === project.path}
          onToggleMenu={onToggleMenu}
          onAssignGroup={onAssignGroup}
        />
      ))}
    </div>
  );
}
