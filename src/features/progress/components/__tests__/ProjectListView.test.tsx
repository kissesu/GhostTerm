/**
 * @file ProjectListView.test.tsx
 * @description ProjectListView 单测：渲染行 / filter 过滤 / 点行进详情
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectListView } from '../ProjectListView';
import type { Project } from '../../api/projects';

function makeProject(id: number, status: Project['status'], name: string): Project {
  return {
    id,
    name,
    customerLabel: '客户' + id,
    description: '',
    priority: 'normal',
    status,
    deadline: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    dealingAt: '2026-01-01',
    originalQuote: '8000',
    currentQuote: '8000',
    afterSalesTotal: '0',
    totalReceived: '0',
    createdBy: 1,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    thesisLevel: 'master',
  };
}

const mockProjects = new Map([
  [1, makeProject(1, 'developing', '开发项目')],
  [2, makeProject(2, 'quoting', '报价项目')],
]);

const mockLoadAll = vi.fn();
const mockOpenProjectFromView = vi.fn();

// filter/search 通过 vi.fn().mockReturnValue 来动态控制
let currentFilter = 'all';
let currentSearch = '';

vi.mock('../../stores/projectsStore', () => ({
  useProjectsStore: (selector: (s: object) => unknown) =>
    selector({ projects: mockProjects, loadAll: mockLoadAll }),
}));

vi.mock('../../stores/progressUiStore', () => ({
  useProgressUiStore: (selector: (s: object) => unknown) =>
    selector({
      statusFilter: currentFilter,
      searchQuery: currentSearch,
      openProjectFromView: mockOpenProjectFromView,
    }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  currentFilter = 'all';
  currentSearch = '';
});

describe('ProjectListView', () => {
  it('渲染所有项目行', () => {
    render(<ProjectListView />);
    expect(screen.getByText('开发项目')).toBeInTheDocument();
    expect(screen.getByText('报价项目')).toBeInTheDocument();
  });

  it('filter=developing → 仅显示 developing 项目', () => {
    currentFilter = 'developing';
    render(<ProjectListView />);
    expect(screen.getByText('开发项目')).toBeInTheDocument();
    expect(screen.queryByText('报价项目')).toBeNull();
  });

  it('点行 → 调用 openProjectFromView(id, "list")', async () => {
    render(<ProjectListView />);
    const row = document.querySelector('[data-project-id="1"]') as HTMLElement;
    await userEvent.click(row);
    expect(mockOpenProjectFromView).toHaveBeenCalledWith(1, 'list');
  });

  it('mount 后调用 loadAll', () => {
    render(<ProjectListView />);
    expect(mockLoadAll).toHaveBeenCalledOnce();
  });
});
