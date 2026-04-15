import { beforeEach, describe, expect, it } from 'vitest';
import type { ProjectInfo } from '../../../shared/types';
import {
  DEFAULT_GROUP_COLOR,
  DEFAULT_GROUP_ICON,
  SYSTEM_GROUP_ALL,
  SYSTEM_GROUP_UNGROUPED,
  buildVisibleGroups,
  filterProjectsByGrouping,
  getProjectGroupId,
  useProjectGroupingStore,
} from '../projectGroupingStore';

const sampleProjects: ProjectInfo[] = [
  {
    name: 'GhostTerm',
    path: '/Users/test/GhostTerm',
    last_opened: 3,
  },
  {
    name: 'GhostCode',
    path: '/Users/test/GhostCode',
    last_opened: 2,
  },
  {
    name: 'Research',
    path: '/Users/test/Research',
    last_opened: 1,
  },
];

describe('projectGroupingStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useProjectGroupingStore.setState({
      groups: [],
      selectedGroupId: 'all',
      projectGroupMap: {},
      searchQuery: '',
    });
  });

  it('默认应选中全部分组', () => {
    expect(useProjectGroupingStore.getState().selectedGroupId).toBe('all');
  });

  it('createGroup 应创建自定义分组', () => {
    const created = useProjectGroupingStore.getState().createGroup('毕设');

    expect(created.name).toBe('毕设');
    expect(created.icon).toBe(DEFAULT_GROUP_ICON);
    expect(created.color).toBe(DEFAULT_GROUP_COLOR);
    expect(useProjectGroupingStore.getState().groups).toHaveLength(1);
  });

  it('deleteGroup 后该组项目应回到未分组', () => {
    const created = useProjectGroupingStore.getState().createGroup('毕设');
    useProjectGroupingStore.getState().assignProjectToGroup('/Users/test/GhostTerm', created.id);

    expect(
      getProjectGroupId('/Users/test/GhostTerm', useProjectGroupingStore.getState().projectGroupMap),
    ).toBe(created.id);

    useProjectGroupingStore.getState().deleteGroup(created.id);

    expect(
      getProjectGroupId('/Users/test/GhostTerm', useProjectGroupingStore.getState().projectGroupMap),
    ).toBe('ungrouped');
  });

  it('buildVisibleGroups 应包含系统分组和自定义分组', () => {
    useProjectGroupingStore.getState().createGroup('毕设');

    const visible = buildVisibleGroups(useProjectGroupingStore.getState().groups, sampleProjects, {});

    expect(visible[0].id).toBe(SYSTEM_GROUP_ALL.id);
    expect(visible[1].id).toBe(SYSTEM_GROUP_UNGROUPED.id);
    expect(visible[2].name).toBe('毕设');
  });

  it('filterProjectsByGrouping 应支持按分组和搜索过滤', () => {
    const created = useProjectGroupingStore.getState().createGroup('毕设');
    useProjectGroupingStore.getState().assignProjectToGroup('/Users/test/GhostTerm', created.id);

    const grouped = filterProjectsByGrouping(sampleProjects, {
      selectedGroupId: created.id,
      searchQuery: 'ghost',
      projectGroupMap: useProjectGroupingStore.getState().projectGroupMap,
    });

    expect(grouped).toHaveLength(1);
    expect(grouped[0].name).toBe('GhostTerm');
  });
});
