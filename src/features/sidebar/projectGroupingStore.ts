/**
 * @file projectGroupingStore.ts
 * @description 项目分组状态管理 - 维护自定义分组、项目到分组映射、当前分组和搜索词。
 *              以“分组后的项目列表”为中心，不修改后端 recent projects 结构。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ProjectInfo } from '../../shared/types';

export type ProjectGroupIcon = 'folders' | 'folder' | 'briefcase';

export const DEFAULT_GROUP_ICON: ProjectGroupIcon = 'briefcase';
export const DEFAULT_GROUP_COLOR = '#5b8def';

export interface ProjectGroup {
  id: string;
  name: string;
  icon: ProjectGroupIcon;
  color: string;
  createdAt: number;
}

export interface VisibleProjectGroup extends ProjectGroup {
  projectCount: number;
  system?: boolean;
}

export const SYSTEM_GROUP_ALL: VisibleProjectGroup = {
  id: 'all',
  name: '全部',
  icon: 'folders',
  color: '#8b8fa8',
  createdAt: 0,
  projectCount: 0,
  system: true,
};

export const SYSTEM_GROUP_UNGROUPED: VisibleProjectGroup = {
  id: 'ungrouped',
  name: '未分组',
  icon: 'folder',
  color: '#6cc092',
  createdAt: 0,
  projectCount: 0,
  system: true,
};

interface ProjectGroupingState {
  groups: ProjectGroup[];
  systemGroupNames: Partial<Record<'ungrouped', string>>;
  selectedGroupId: string;
  projectGroupMap: Record<string, string>;
  searchQuery: string;
  createGroup: (name: string) => ProjectGroup;
  renameGroup: (groupId: string, name: string) => void;
  deleteGroup: (groupId: string) => void;
  selectGroup: (groupId: string) => void;
  assignProjectToGroup: (projectPath: string, groupId: string) => void;
  setSearchQuery: (query: string) => void;
}

function makeGroupId() {
  return `group_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function normalizeName(name: string) {
  return name.trim();
}

export function getProjectGroupId(projectPath: string, projectGroupMap: Record<string, string>) {
  return projectGroupMap[projectPath] ?? 'ungrouped';
}

export function buildVisibleGroups(
  groups: ProjectGroup[],
  projects: ProjectInfo[],
  projectGroupMap: Record<string, string>,
  systemGroupNames: Partial<Record<'ungrouped', string>> = {},
): VisibleProjectGroup[] {
  const counts = new Map<string, number>();

  counts.set('all', projects.length);
  counts.set('ungrouped', 0);

  for (const group of groups) {
    counts.set(group.id, 0);
  }

  for (const project of projects) {
    const groupId = getProjectGroupId(project.path, projectGroupMap);
    if (!counts.has(groupId)) {
      counts.set('ungrouped', (counts.get('ungrouped') ?? 0) + 1);
      continue;
    }
    counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
  }

  return [
    { ...SYSTEM_GROUP_ALL, projectCount: counts.get('all') ?? 0 },
    {
      ...SYSTEM_GROUP_UNGROUPED,
      name: systemGroupNames.ungrouped?.trim() || SYSTEM_GROUP_UNGROUPED.name,
      projectCount: counts.get('ungrouped') ?? 0,
    },
    ...groups.map((group) => ({
      ...group,
      projectCount: counts.get(group.id) ?? 0,
    })),
  ];
}

export function filterProjectsByGrouping(
  projects: ProjectInfo[],
  options: {
    selectedGroupId: string;
    searchQuery: string;
    projectGroupMap: Record<string, string>;
  },
) {
  const search = options.searchQuery.trim().toLowerCase();

  return projects.filter((project) => {
    const groupId = getProjectGroupId(project.path, options.projectGroupMap);

    const matchesGroup =
      options.selectedGroupId === 'all'
        ? true
        : groupId === options.selectedGroupId;

    if (!matchesGroup) return false;

    if (!search) return true;

    return (
      project.name.toLowerCase().includes(search) ||
      project.path.toLowerCase().includes(search)
    );
  });
}

export const useProjectGroupingStore = create<ProjectGroupingState>()(
  persist(
    (set) => ({
      groups: [],
      systemGroupNames: {},
      selectedGroupId: 'all',
      projectGroupMap: {},
      searchQuery: '',

      createGroup: (name: string) => {
        const normalized = normalizeName(name);
        if (!normalized) {
          throw new Error('分组名称不能为空');
        }

        const group: ProjectGroup = {
          id: makeGroupId(),
          name: normalized,
          icon: DEFAULT_GROUP_ICON,
          color: DEFAULT_GROUP_COLOR,
          createdAt: Date.now(),
        };

        set((state) => ({
          groups: [...state.groups, group],
        }));

        return group;
      },

      renameGroup: (groupId, name) => {
        const normalized = normalizeName(name);
        if (!normalized) return;
        if (groupId === 'ungrouped') {
          set((state) => ({
            systemGroupNames: {
              ...state.systemGroupNames,
              ungrouped: normalized,
            },
          }));
          return;
        }
        if (groupId === 'all') return;
        set((state) => ({
          groups: state.groups.map((group) =>
            group.id === groupId ? { ...group, name: normalized } : group,
          ),
        }));
      },

      deleteGroup: (groupId) => {
        if (groupId === 'all' || groupId === 'ungrouped') return;
        set((state) => {
          const nextMap = { ...state.projectGroupMap };
          for (const [path, mappedGroupId] of Object.entries(nextMap)) {
            if (mappedGroupId === groupId) {
              nextMap[path] = 'ungrouped';
            }
          }

          return {
            groups: state.groups.filter((group) => group.id !== groupId),
            projectGroupMap: nextMap,
            selectedGroupId:
              state.selectedGroupId === groupId ? 'ungrouped' : state.selectedGroupId,
          };
        });
      },

      selectGroup: (groupId) => set({ selectedGroupId: groupId }),

      assignProjectToGroup: (projectPath, groupId) =>
        set((state) => ({
          projectGroupMap: {
            ...state.projectGroupMap,
            [projectPath]: groupId === 'all' ? 'ungrouped' : groupId,
          },
        })),

      setSearchQuery: (query) => set({ searchQuery: query }),
    }),
    {
      name: 'ghostterm-project-grouping',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        groups: state.groups,
        systemGroupNames: state.systemGroupNames,
        selectedGroupId: state.selectedGroupId,
        projectGroupMap: state.projectGroupMap,
      }),
    },
  ),
);
