import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import ProjectSelector from '../ProjectSelector';
import { useProjectStore } from '../projectStore';
import { useProjectGroupingStore } from '../projectGroupingStore';
import type { ProjectInfo } from '../../../shared/types';

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

// 避免 openProject 触发真实 activateProject → spawn_pty_cmd 污染其他测试的 invoke mock
// mockActivateProject 暴露给测试文件，用于验证调用
const mockActivateProject = vi.fn().mockResolvedValue(undefined);
vi.mock('../../terminal/terminalStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../terminal/terminalStore')>();
  return {
    ...actual,
    useTerminalStore: Object.assign(Object.create(Object.getPrototypeOf(actual.useTerminalStore)), actual.useTerminalStore, {
      getState: () => ({
        ...actual.useTerminalStore.getState(),
        activateProject: mockActivateProject,
      }),
    }),
  };
});

const mockInvoke = vi.mocked(invoke);

const projects: ProjectInfo[] = [
  {
    name: 'GhostTerm',
    path: '/Users/atlas/GhostTerm',
    last_opened: 3,
  },
  {
    name: '毕设-开封旅游',
    path: '/Users/atlas/Projects/毕设-开封旅游',
    last_opened: 2,
  },
  {
    name: 'GhostCode',
    path: '/Users/atlas/GhostCode',
    last_opened: 1,
  },
];

beforeEach(() => {
  localStorage.clear();
  useProjectStore.setState({
    currentProject: projects[0],
    recentProjects: projects,
  });
  useProjectGroupingStore.setState({
    groups: [],
    selectedGroupId: 'all',
    projectGroupMap: {},
    searchQuery: '',
  });
  vi.clearAllMocks();
});

describe('ProjectSelector', () => {
  it('默认应显示当前分组栏而不是最近项目下拉按钮', () => {
    render(<ProjectSelector />);

    expect(screen.getByTestId('project-group-header')).toBeInTheDocument();
    expect(screen.getByText('全部')).toBeInTheDocument();
    expect(screen.getByTestId('project-group-count')).toHaveTextContent('3');
  });

  it('点击下拉按钮应展开分组面板', async () => {
    const user = userEvent.setup();
    render(<ProjectSelector />);

    await user.click(screen.getByTestId('project-group-toggle'));

    expect(screen.getByTestId('project-group-menu')).toBeInTheDocument();
    expect(screen.getByText('未分组')).toBeInTheDocument();
    expect(screen.getByText('新建分组')).toBeInTheDocument();
  });

  it('切换分组后应只显示该分组项目', async () => {
    const user = userEvent.setup();
    const group = useProjectGroupingStore.getState().createGroup('毕设');
    useProjectGroupingStore.getState().assignProjectToGroup(projects[1].path, group.id);

    render(<ProjectSelector />);

    await user.click(screen.getByTestId('project-group-toggle'));
    await user.click(screen.getByRole('button', { name: '切换到毕设' }));

    expect(screen.getByTestId('project-group-label')).toHaveTextContent('毕设');
    expect(screen.getByText('毕设-开封旅游')).toBeInTheDocument();
    expect(screen.queryByText('GhostCode')).not.toBeInTheDocument();
  });

  it('搜索应在当前分组范围内过滤项目', async () => {
    const user = userEvent.setup();
    render(<ProjectSelector />);

    await user.type(screen.getByTestId('project-search-input'), 'ghost');

    expect(screen.getByText('GhostTerm')).toBeInTheDocument();
    expect(screen.getByText('GhostCode')).toBeInTheDocument();
    expect(screen.queryByText('毕设-开封旅游')).not.toBeInTheDocument();
  });

  it('点击项目卡片应调用项目切换链路', async () => {
    mockInvoke
      .mockResolvedValueOnce(projects[1])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce('main')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(projects);

    const user = userEvent.setup();
    render(<ProjectSelector />);

    await user.click(screen.getByRole('button', { name: '打开项目 毕设-开封旅游' }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('open_project_cmd', {
        path: '/Users/atlas/Projects/毕设-开封旅游',
      });
    });
  });

  it('点击当前项目不应重复触发项目切换', async () => {
    const user = userEvent.setup();
    render(<ProjectSelector />);

    await user.click(screen.getByRole('button', { name: '打开项目 GhostTerm' }));

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('点击项目展开后应保持原列表顺序与滚动位置', async () => {
    useProjectStore.setState((state) => ({
      ...state,
      switchProject: async (path: string) => {
        const nextProject = projects.find((project) => project.path === path) ?? null;
        useProjectStore.setState({ currentProject: nextProject });
      },
    }));

    const user = userEvent.setup();
    render(<ProjectSelector />);

    const scrollContainer = screen.getByTestId('project-list-scroll-container');
    Object.defineProperty(scrollContainer, 'scrollTop', {
      value: 148,
      writable: true,
      configurable: true,
    });

    await user.click(screen.getByRole('button', { name: '打开项目 毕设-开封旅游' }));

    await waitFor(() => {
      expect(useProjectStore.getState().currentProject?.path).toBe('/Users/atlas/Projects/毕设-开封旅游');
    });

    await waitFor(() => {
      expect(scrollContainer.scrollTop).toBe(148);
    });

    const projectButtons = screen
      .getAllByRole('button', { name: /打开项目 / })
      .map((button) => button.textContent?.replace(/\s+/g, '') ?? '');
    expect(projectButtons).toEqual([
      'GhostTerm.../GhostTerm',
      '毕设-开封旅游.../Projects/毕设-开封旅游',
      'GhostCode.../GhostCode',
    ]);
  });

  it('项目卡片应支持把项目移动到指定分组', async () => {
    const user = userEvent.setup();
    const group = useProjectGroupingStore.getState().createGroup('毕设');

    render(<ProjectSelector />);

    await user.click(screen.getByRole('button', { name: '管理项目 GhostCode' }));
    await user.click(screen.getByRole('menuitem', { name: '移动到分组 毕设' }));
    await user.click(screen.getByTestId('project-group-toggle'));
    await user.click(screen.getByRole('button', { name: '切换到毕设' }));

    expect(screen.getByText('GhostCode')).toBeInTheDocument();
    expect(screen.queryByText('GhostTerm')).not.toBeInTheDocument();
    expect(useProjectGroupingStore.getState().projectGroupMap[projects[2].path]).toBe(group.id);
  });

  it('应通过对话框新建分组', async () => {
    const user = userEvent.setup();
    render(<ProjectSelector />);

    await user.click(screen.getByTestId('project-group-toggle'));
    await user.click(screen.getByText('新建分组'));

    expect(screen.getByTestId('group-create-dialog')).toBeInTheDocument();
    await user.type(screen.getByTestId('group-name-input'), '客户端');
    await user.click(screen.getByTestId('group-create-confirm'));

    expect(screen.queryByTestId('group-create-dialog')).not.toBeInTheDocument();
    expect(useProjectGroupingStore.getState().groups.some((group) => group.name === '客户端')).toBe(true);
  });

  it('应通过对话框重命名当前分组', async () => {
    const user = userEvent.setup();
    const group = useProjectGroupingStore.getState().createGroup('旧分组');
    useProjectGroupingStore.getState().selectGroup(group.id);

    render(<ProjectSelector />);

    await user.click(screen.getByRole('button', { name: '编辑分组' }));
    await user.click(screen.getByText('重命名分组'));

    const input = screen.getByTestId('group-rename-input');
    expect(screen.getByTestId('group-rename-dialog')).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, '新分组');
    await user.click(screen.getByTestId('group-rename-confirm'));

    expect(screen.queryByTestId('group-rename-dialog')).not.toBeInTheDocument();
    expect(useProjectGroupingStore.getState().groups.find((item) => item.id === group.id)?.name).toBe('新分组');
    expect(screen.getByTestId('project-group-label')).toHaveTextContent('新分组');
  });

  it('应通过确认对话框删除当前分组并把项目移回未分组', async () => {
    const user = userEvent.setup();
    const group = useProjectGroupingStore.getState().createGroup('临时分组');
    useProjectGroupingStore.getState().assignProjectToGroup(projects[2].path, group.id);
    useProjectGroupingStore.getState().selectGroup(group.id);

    render(<ProjectSelector />);

    await user.click(screen.getByRole('button', { name: '编辑分组' }));
    await user.click(screen.getByText('删除分组'));

    expect(screen.getByTestId('group-delete-dialog')).toBeInTheDocument();
    await user.click(screen.getByTestId('group-delete-confirm'));

    expect(screen.queryByTestId('group-delete-dialog')).not.toBeInTheDocument();
    expect(useProjectGroupingStore.getState().groups.find((item) => item.id === group.id)).toBeUndefined();
    expect(useProjectGroupingStore.getState().selectedGroupId).toBe('ungrouped');
    expect(useProjectGroupingStore.getState().projectGroupMap[projects[2].path]).toBe('ungrouped');
  });

  it('项目卡片当前激活态应更明显并带有活跃标记', () => {
    render(<ProjectSelector />);

    const activeCard = screen.getByTestId(`project-card-${projects[0].name}`);
    const inactiveCard = screen.getByTestId(`project-card-${projects[1].name}`);

    expect(activeCard).toHaveAttribute('data-active', 'true');
    expect(inactiveCard).toHaveAttribute('data-active', 'false');
    expect(activeCard).toHaveStyle({
      background: '#414868',
      boxShadow: '0 0 0 1px rgba(122,162,247,0.38), 0 14px 30px rgba(15,17,26,0.32)',
    });
  });

  it('自定义分组中的项目应支持移回未分组', async () => {
    const user = userEvent.setup();
    const group = useProjectGroupingStore.getState().createGroup('客户端');
    useProjectGroupingStore.getState().assignProjectToGroup(projects[2].path, group.id);
    useProjectGroupingStore.getState().selectGroup(group.id);

    render(<ProjectSelector />);

    await user.click(screen.getByRole('button', { name: '管理项目 GhostCode' }));
    await user.click(screen.getByRole('menuitem', { name: '移动到分组 未分组' }));

    expect(useProjectGroupingStore.getState().projectGroupMap[projects[2].path]).toBe('ungrouped');
    expect(screen.queryByText('GhostCode')).not.toBeInTheDocument();
  });

  it('未分组也应允许打开重命名分组对话框', async () => {
    const user = userEvent.setup();
    useProjectGroupingStore.setState({ selectedGroupId: 'ungrouped' });
    render(<ProjectSelector />);

    await user.click(screen.getByRole('button', { name: '编辑分组' }));
    await user.click(screen.getByText('重命名分组'));

    expect(screen.getByTestId('group-rename-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('group-rename-input')).toHaveValue('未分组');
  });

  it('项目卡片不应再渲染行内添加项目按钮', () => {
    render(<ProjectSelector />);

    expect(screen.queryByRole('button', { name: '向分组添加项目 GhostTerm' })).not.toBeInTheDocument();
  });

  it('openProject 调用 saveSession 保存旧状态而非 closeAll', async () => {
    const { useEditorStore } = await import('../../editor/editorStore');
    const { useTerminalStore } = await import('../../terminal/terminalStore');
    const { useFileTreeStore } = await import('../fileTreeStore');
    const { useGitStore } = await import('../gitStore');

    const saveSession = vi.fn();
    const restoreSession = vi.fn();
    // terminalStore 已被顶部 vi.mock 替换，直接从 getState() 取 activateProject mock 引用
    const activateProject = useTerminalStore.getState().activateProject as ReturnType<typeof vi.fn>;

    // spy 所有会调 invoke 的子系统，替换为 noop，确保 invoke mock 队列只用于验证
    const fileTreeSpy = vi.spyOn(useFileTreeStore, 'getState').mockReturnValue({
      ...useFileTreeStore.getState(),
      refreshFileTree: vi.fn().mockResolvedValue(undefined),
    });
    const gitSpy = vi.spyOn(useGitStore, 'getState').mockReturnValue({
      ...useGitStore.getState(),
      refreshGitStatus: vi.fn().mockResolvedValue(undefined),
      refreshWorktrees: vi.fn().mockResolvedValue(undefined),
    });
    const editorSpy = vi.spyOn(useEditorStore, 'getState').mockReturnValue({
      ...useEditorStore.getState(),
      saveSession,
      restoreSession,
    });

    try {
      // 只需 mock open_project_cmd，其余子系统已被 spy 替换
      mockInvoke.mockResolvedValueOnce({ name: 'proj-b', path: '/proj-b', last_opened: 0 });

      useProjectStore.setState({
        currentProject: { name: 'proj-a', path: '/proj-a', last_opened: 0 },
        recentProjects: [
          { name: 'proj-a', path: '/proj-a', last_opened: 0 },
          { name: 'proj-b', path: '/proj-b', last_opened: 0 },
        ],
      });

      await useProjectStore.getState().openProject('/proj-b');

      expect(saveSession).toHaveBeenCalledWith('/proj-a');
      expect(restoreSession).toHaveBeenCalledWith('/proj-b');
      expect(activateProject).toHaveBeenCalledWith('/proj-b');
    } finally {
      // 无论测试成败，恢复所有 spy，避免污染其他测试
      editorSpy.mockRestore();
      fileTreeSpy.mockRestore();
      gitSpy.mockRestore();
    }
  });
});
