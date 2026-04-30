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

vi.mock('../../api/customers', () => ({
  customers: {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

import { KanbanView } from '../KanbanView';
import { listProjects } from '../../api/projects';
import { customers as customersApi } from '../../api/customers';
import { useProjectsStore } from '../../stores/projectsStore';
import { useCustomersStore } from '../../stores/customersStore';
import { useProgressUiStore } from '../../stores/progressUiStore';
import type { Project } from '../../api/projects';

const mockedList = vi.mocked(listProjects);
const mockedCustomersList = vi.mocked(customersApi.list);

function makeProject(over: Partial<Project>): Project {
  return {
    id: 1,
    name: '示例',
    customerId: 1,
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
  useCustomersStore.getState().clear();
  useProgressUiStore.getState().reset();
  mockedList.mockReset();
  mockedCustomersList.mockReset();
  mockedList.mockResolvedValue([]);
  mockedCustomersList.mockResolvedValue([]);
});

describe('KanbanView 列结构', () => {
  it('渲染 9 个状态列', async () => {
    render(<KanbanView />);
    await waitFor(() => expect(screen.getByTestId('kanban-view')).toBeInTheDocument());

    // 7 主动状态 + archived + cancelled 共 9 列
    expect(screen.getByTestId('kanban-column-dealing')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-column-quoting')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-column-developing')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-column-confirming')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-column-delivered')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-column-paid')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-column-after_sales')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-column-archived')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-column-cancelled')).toBeInTheDocument();
  });

  it('archived / cancelled 默认折叠（其他展开）', async () => {
    render(<KanbanView />);
    await waitFor(() => expect(screen.getByTestId('kanban-view')).toBeInTheDocument());

    expect(screen.getByTestId('kanban-column-archived')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByTestId('kanban-column-cancelled')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByTestId('kanban-column-dealing')).toHaveAttribute('data-collapsed', 'false');
  });

  it('点击列 header 切换折叠态', async () => {
    render(<KanbanView />);
    await waitFor(() => expect(screen.getByTestId('kanban-view')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('kanban-column-header-dealing'));
    expect(screen.getByTestId('kanban-column-dealing')).toHaveAttribute('data-collapsed', 'true');
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
