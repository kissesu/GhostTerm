/**
 * @file KanbanView.test.tsx
 * @description Phase 10 看板视图 RTL 单测：
 *              - 渲染 9 个状态列（archived / cancelled 默认折叠）
 *              - 项目按 status 分组
 *              - 卡片点击 → setSelectedProject
 *              - statusFilter 应用时只显示对应列
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../api/projects', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    listProjects: vi.fn().mockResolvedValue([]),
    createProject: vi.fn(),
    getProject: vi.fn(),
    updateProject: vi.fn(),
    triggerProjectEvent: vi.fn(),
  };
});

// 用户需求修正 2026-04-30：客户从独立资源降级为字段，不再需要 mock customers store

import { KanbanView } from '../KanbanView';
import { listProjects } from '../../api/projects';
import { useProjectsStore } from '../../stores/projectsStore';
import { useProgressUiStore } from '../../stores/progressUiStore';
import type { Project } from '../../api/projects';

const mockedList = vi.mocked(listProjects);

function makeProject(over: Partial<Project>): Project {
  return {
    id: 1,
    name: '示例',
    customerLabel: '李四@wx',
    description: '描述',
    priority: 'normal',
    status: 'dealing',
    deadline: '2026-12-31T00:00:00.000Z',
    dealingAt: '2026-04-29T00:00:00.000Z',
    originalQuote: '0.00',
    currentQuote: '5000.00',
    afterSalesTotal: '0.00',
    totalReceived: '0.00',
    createdBy: 1,
    createdAt: '2026-04-29T00:00:00.000Z',
    updatedAt: '2026-04-29T00:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  useProjectsStore.getState().clear();
  useProgressUiStore.getState().reset();
  mockedList.mockReset();
  mockedList.mockResolvedValue([]);
});

describe('KanbanView 列结构', () => {
  it('渲染设计稿 6 个核心列 S1-S6', async () => {
    render(<KanbanView />);
    await waitFor(() => expect(screen.getByTestId('kanban-view')).toBeInTheDocument());

    // 设计稿主板 6 列：dealing / quoting / developing / confirming / delivered / paid
    expect(screen.getByTestId('kanban-column-dealing')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-column-quoting')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-column-developing')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-column-confirming')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-column-delivered')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-column-paid')).toBeInTheDocument();
  });

  it('archived / after_sales / cancelled 不在主板显示（仅通过 statusFilter 单独筛选时显示）', async () => {
    render(<KanbanView />);
    await waitFor(() => expect(screen.getByTestId('kanban-view')).toBeInTheDocument());

    // 设计稿主板 1:1 复刻：仅 6 列；其他状态走 statusFilter
    expect(screen.queryByTestId('kanban-column-archived')).toBeNull();
    expect(screen.queryByTestId('kanban-column-after_sales')).toBeNull();
    expect(screen.queryByTestId('kanban-column-cancelled')).toBeNull();
  });

  it('每列 data-collapsed=false（设计稿无折叠态）', async () => {
    render(<KanbanView />);
    await waitFor(() => expect(screen.getByTestId('kanban-view')).toBeInTheDocument());

    expect(screen.getByTestId('kanban-column-dealing')).toHaveAttribute('data-collapsed', 'false');
    expect(screen.getByTestId('kanban-column-paid')).toHaveAttribute('data-collapsed', 'false');
  });
});

describe('KanbanView 卡片分组', () => {
  it('项目按 status 分组渲染到对应列', async () => {
    mockedList.mockResolvedValueOnce([
      makeProject({ id: 1, status: 'dealing', name: 'A' }),
      makeProject({ id: 2, status: 'developing', name: 'B' }),
      makeProject({ id: 3, status: 'developing', name: 'C' }),
    ]);

    render(<KanbanView />);
    await waitFor(() => expect(screen.getByTestId('kanban-card-1')).toBeInTheDocument());

    expect(screen.getByTestId('kanban-card-1')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-card-2')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-card-3')).toBeInTheDocument();

    // 卡片在正确的列内（用 within 子树查询）
    const dealingCol = screen.getByTestId('kanban-column-dealing');
    expect(dealingCol).toContainElement(screen.getByTestId('kanban-card-1'));
    const developingCol = screen.getByTestId('kanban-column-developing');
    expect(developingCol).toContainElement(screen.getByTestId('kanban-card-2'));
    expect(developingCol).toContainElement(screen.getByTestId('kanban-card-3'));
  });
});

describe('KanbanView 卡片点击', () => {
  it('点击卡片 setSelectedProject', async () => {
    mockedList.mockResolvedValueOnce([makeProject({ id: 42, status: 'dealing' })]);
    render(<KanbanView />);
    await waitFor(() => expect(screen.getByTestId('kanban-card-42')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('kanban-card-42'));

    expect(useProgressUiStore.getState().selectedProjectId).toBe(42);
  });
});

describe('KanbanView statusFilter', () => {
  it('statusFilter 仅显示对应列', async () => {
    useProgressUiStore.getState().setStatusFilter('developing');
    render(<KanbanView />);
    await waitFor(() => expect(screen.getByTestId('kanban-view')).toBeInTheDocument());

    expect(screen.getByTestId('kanban-column-developing')).toBeInTheDocument();
    expect(screen.queryByTestId('kanban-column-dealing')).toBeNull();
    expect(screen.queryByTestId('kanban-column-quoting')).toBeNull();
  });
});
