/**
 * @file ProjectListView.test.tsx
 * @description Phase 10 列表视图 RTL 单测：
 *              - 渲染表格行（基础结构）
 *              - 按 deadline ASC 排序（最紧急在前）
 *              - 状态过滤（statusFilter）
 *              - 搜索过滤（searchQuery 在项目名 + 客户名上 contains）
 *              - 行点击 → setSelectedProject
 *
 *              mock 策略：
 *              - mock api/projects + api/customers 让 store 不发真实请求
 *              - 通过 store.setProject 直接预置数据
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// ============================================
// mock api 层（projectsStore / customersStore 的依赖）
// 注意：useEffect 内 loadProjects/fetchAll 会调 mock；mock 返回的数据会
// 覆盖手动 setProject 的预置；测试必须经 mock 设置数据
// ============================================
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

import { ProjectListView } from '../ProjectListView';
import { listProjects } from '../../api/projects';
import { customers as customersApi } from '../../api/customers';
import { useProjectsStore } from '../../stores/projectsStore';
import { useCustomersStore } from '../../stores/customersStore';
import { useProgressUiStore } from '../../stores/progressUiStore';
import type { Project } from '../../api/projects';
import type { CustomerPayload } from '../../api/schemas';

const mockedList = vi.mocked(listProjects);
const mockedCustomersList = vi.mocked(customersApi.list);

const customer1: CustomerPayload = {
  id: 1,
  nameWechat: '李四@wx',
  remark: null,
  createdBy: 1,
  createdAt: '2026-04-01T00:00:00Z',
  updatedAt: '2026-04-01T00:00:00Z',
};

const customer2: CustomerPayload = {
  id: 2,
  nameWechat: '王五@wx',
  remark: null,
  createdBy: 1,
  createdAt: '2026-04-01T00:00:00Z',
  updatedAt: '2026-04-01T00:00:00Z',
};

function makeProject(over: Partial<Project>): Project {
  return {
    id: 1,
    name: '示例项目',
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
  // 默认空数据；具体用例可 override
  mockedList.mockResolvedValue([]);
  mockedCustomersList.mockResolvedValue([]);
});

describe('ProjectListView 基础渲染', () => {
  it('无项目时显示空态', async () => {
    render(<ProjectListView />);
    expect(await screen.findByTestId('project-list-empty')).toBeInTheDocument();
  });

  it('有项目时渲染表格 + 行', async () => {
    mockedList.mockResolvedValueOnce([makeProject({ id: 1, name: 'Alpha' })]);
    mockedCustomersList.mockResolvedValueOnce([customer1]);

    render(<ProjectListView />);

    await waitFor(() => expect(screen.getByTestId('project-list-view')).toBeInTheDocument());
    expect(screen.getByTestId('project-row-1')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('李四@wx')).toBeInTheDocument();
  });
});

describe('ProjectListView 排序', () => {
  it('按 deadline ASC 排序（紧急在前）', async () => {
    // 故意乱序：远期 / 近期 / 中期；UI 应把"近期"排第一
    mockedList.mockResolvedValueOnce([
      makeProject({ id: 1, name: 'Far', deadline: '2030-01-01T00:00:00Z' }),
      makeProject({ id: 2, name: 'Near', deadline: '2026-05-01T00:00:00Z' }),
      makeProject({ id: 3, name: 'Mid', deadline: '2027-01-01T00:00:00Z' }),
    ]);

    render(<ProjectListView />);

    await waitFor(() => expect(screen.getByTestId('project-list-view')).toBeInTheDocument());

    // 严格匹配 project-row-<id>，排除 status / deadline 子元素的 testid
    const rows = screen.getAllByTestId(/^project-row-\d+$/);
    expect(rows[0]).toHaveAttribute('data-testid', 'project-row-2'); // Near (最早)
    expect(rows[1]).toHaveAttribute('data-testid', 'project-row-3'); // Mid
    expect(rows[2]).toHaveAttribute('data-testid', 'project-row-1'); // Far
  });
});

describe('ProjectListView 状态过滤', () => {
  it('statusFilter 设为 developing → 仅渲染 developing 行', async () => {
    mockedList.mockResolvedValueOnce([
      makeProject({ id: 1, name: 'A', status: 'dealing' }),
      makeProject({ id: 2, name: 'B', status: 'developing' }),
      makeProject({ id: 3, name: 'C', status: 'paid' }),
    ]);
    useProgressUiStore.getState().setStatusFilter('developing');

    render(<ProjectListView />);

    await waitFor(() => expect(screen.getByTestId('project-list-view')).toBeInTheDocument());
    expect(screen.queryByTestId('project-row-1')).toBeNull();
    expect(screen.getByTestId('project-row-2')).toBeInTheDocument();
    expect(screen.queryByTestId('project-row-3')).toBeNull();
  });
});

describe('ProjectListView 搜索过滤', () => {
  it('searchQuery 命中项目名', async () => {
    mockedList.mockResolvedValueOnce([
      makeProject({ id: 1, name: 'Alpha 项目' }),
      makeProject({ id: 2, name: 'Beta 项目' }),
    ]);
    useProgressUiStore.getState().setSearchQuery('alpha');

    render(<ProjectListView />);

    await waitFor(() => expect(screen.getByTestId('project-list-view')).toBeInTheDocument());
    expect(screen.getByTestId('project-row-1')).toBeInTheDocument();
    expect(screen.queryByTestId('project-row-2')).toBeNull();
  });

  it('searchQuery 命中客户名', async () => {
    mockedList.mockResolvedValueOnce([
      makeProject({ id: 1, customerId: 1, name: 'A' }),
      makeProject({ id: 2, customerId: 2, name: 'B' }),
    ]);
    mockedCustomersList.mockResolvedValueOnce([customer1, customer2]);
    useProgressUiStore.getState().setSearchQuery('王五');

    render(<ProjectListView />);

    await waitFor(() => expect(screen.getByTestId('project-list-view')).toBeInTheDocument());
    expect(screen.queryByTestId('project-row-1')).toBeNull();
    expect(screen.getByTestId('project-row-2')).toBeInTheDocument();
  });
});

describe('ProjectListView 行点击', () => {
  it('点击行调 setSelectedProject', async () => {
    mockedList.mockResolvedValueOnce([makeProject({ id: 7, name: 'Click Me' })]);

    render(<ProjectListView />);

    await waitFor(() => expect(screen.getByTestId('project-row-7')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('project-row-7'));

    expect(useProgressUiStore.getState().selectedProjectId).toBe(7);
  });
});
