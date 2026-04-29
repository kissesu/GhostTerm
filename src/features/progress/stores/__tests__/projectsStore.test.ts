/**
 * @file projectsStore.test.ts
 * @description Phase 5 projectsStore 单测：
 *              - selectByID / selectAll：Map 查询
 *              - setProject / removeProject：内部 mutator
 *              - load / loadOne / create / update / triggerEvent：调 mock api 后 store 同步
 *              - clear：登出场景重置
 *
 *              api/projects 模块整体 mock，避免任何真实网络。
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================
// mock api/projects（hoisted by vitest）
// ============================================
vi.mock('../../api/projects', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    listProjects: vi.fn(),
    createProject: vi.fn(),
    getProject: vi.fn(),
    updateProject: vi.fn(),
    triggerProjectEvent: vi.fn(),
  };
});

import {
  createProject,
  getProject,
  listProjects,
  triggerProjectEvent,
  updateProject,
  type Project,
} from '../../api/projects';
import { useProjectsStore } from '../projectsStore';

const mockedList = vi.mocked(listProjects);
const mockedCreate = vi.mocked(createProject);
const mockedGet = vi.mocked(getProject);
const mockedUpdate = vi.mocked(updateProject);
const mockedTrigger = vi.mocked(triggerProjectEvent);

// ============================================
// 测试用 fixture
// ============================================

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 1,
    name: '示例项目',
    customerId: 100,
    description: '描述',
    priority: 'normal',
    status: 'dealing',
    deadline: '2026-05-29T00:00:00Z',
    dealingAt: '2026-04-29T00:00:00Z',
    originalQuote: '0.00',
    currentQuote: '0.00',
    afterSalesTotal: '0.00',
    totalReceived: '0.00',
    createdBy: 1,
    createdAt: '2026-04-29T00:00:00Z',
    updatedAt: '2026-04-29T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  // 每个用例前清空 store + 重置 mock
  useProjectsStore.getState().clear();
  mockedList.mockReset();
  mockedCreate.mockReset();
  mockedGet.mockReset();
  mockedUpdate.mockReset();
  mockedTrigger.mockReset();
});

// ============================================
// selectByID / selectAll / setProject / removeProject
// ============================================

describe('projectsStore selectors + mutators', () => {
  it('setProject / selectByID 直接读写', () => {
    const p = makeProject({ id: 7, name: 'A' });
    useProjectsStore.getState().setProject(p);
    expect(useProjectsStore.getState().selectByID(7)).toEqual(p);
    expect(useProjectsStore.getState().selectByID(8)).toBeUndefined();
  });

  it('selectAll 按插入顺序返回', () => {
    const p1 = makeProject({ id: 1, name: 'first' });
    const p2 = makeProject({ id: 2, name: 'second' });
    useProjectsStore.getState().setProject(p1);
    useProjectsStore.getState().setProject(p2);
    const all = useProjectsStore.getState().selectAll();
    expect(all).toHaveLength(2);
    expect(all[0]?.id).toBe(1);
    expect(all[1]?.id).toBe(2);
  });

  it('removeProject 删除单条', () => {
    useProjectsStore.getState().setProject(makeProject({ id: 5 }));
    useProjectsStore.getState().setProject(makeProject({ id: 6 }));
    useProjectsStore.getState().removeProject(5);
    expect(useProjectsStore.getState().selectByID(5)).toBeUndefined();
    expect(useProjectsStore.getState().selectByID(6)).toBeDefined();
    expect(useProjectsStore.getState().selectAll()).toHaveLength(1);
  });

  it('clear 重置所有 state', () => {
    useProjectsStore.getState().setProject(makeProject({ id: 1 }));
    useProjectsStore.setState({ loading: true, lastStatusFilter: 'paid' });
    useProjectsStore.getState().clear();
    expect(useProjectsStore.getState().selectAll()).toHaveLength(0);
    expect(useProjectsStore.getState().loading).toBe(false);
    expect(useProjectsStore.getState().lastStatusFilter).toBeNull();
  });
});

// ============================================
// load: 全量加载 + status filter
// ============================================

describe('projectsStore.load', () => {
  it('load 后 store 含全部项目', async () => {
    const arr = [makeProject({ id: 1 }), makeProject({ id: 2 })];
    mockedList.mockResolvedValueOnce(arr);

    await useProjectsStore.getState().load();

    expect(mockedList).toHaveBeenCalledWith(undefined);
    const all = useProjectsStore.getState().selectAll();
    expect(all).toHaveLength(2);
    expect(useProjectsStore.getState().loading).toBe(false);
    expect(useProjectsStore.getState().lastStatusFilter).toBeNull();
  });

  it('load with status filter 透传给 api', async () => {
    mockedList.mockResolvedValueOnce([]);
    await useProjectsStore.getState().load('paid');
    expect(mockedList).toHaveBeenCalledWith('paid');
    expect(useProjectsStore.getState().lastStatusFilter).toBe('paid');
  });

  it('load 失败时清掉 loading 并 rethrow', async () => {
    const err = new Error('boom');
    mockedList.mockRejectedValueOnce(err);
    await expect(useProjectsStore.getState().load()).rejects.toBe(err);
    expect(useProjectsStore.getState().loading).toBe(false);
  });
});

// ============================================
// loadOne: 单条
// ============================================

describe('projectsStore.loadOne', () => {
  it('成功 loadOne 后 store 含此项', async () => {
    const p = makeProject({ id: 42, name: 'single' });
    mockedGet.mockResolvedValueOnce(p);

    const got = await useProjectsStore.getState().loadOne(42);
    expect(got).toEqual(p);
    expect(useProjectsStore.getState().selectByID(42)).toEqual(p);
  });

  it('loadOne 不影响其它项目', async () => {
    useProjectsStore.getState().setProject(makeProject({ id: 1, name: 'old' }));
    const p2 = makeProject({ id: 2, name: 'new' });
    mockedGet.mockResolvedValueOnce(p2);

    await useProjectsStore.getState().loadOne(2);

    expect(useProjectsStore.getState().selectByID(1)?.name).toBe('old');
    expect(useProjectsStore.getState().selectByID(2)).toEqual(p2);
  });
});

// ============================================
// create
// ============================================

describe('projectsStore.create', () => {
  it('create 成功后自动写入 store', async () => {
    const p = makeProject({ id: 99, name: 'new' });
    mockedCreate.mockResolvedValueOnce(p);

    const got = await useProjectsStore.getState().create({
      name: 'new',
      customerId: 1,
      description: 'd',
      deadline: '2026-12-31T00:00:00Z',
    });
    expect(got).toEqual(p);
    expect(useProjectsStore.getState().selectByID(99)).toEqual(p);
  });

  it('create 失败时不更新 store', async () => {
    mockedCreate.mockRejectedValueOnce(new Error('rejected'));
    await expect(
      useProjectsStore.getState().create({
        name: 'x',
        customerId: 1,
        description: 'd',
        deadline: '2026-12-31T00:00:00Z',
      }),
    ).rejects.toThrow('rejected');
    expect(useProjectsStore.getState().selectAll()).toHaveLength(0);
  });
});

// ============================================
// update / triggerEvent
// ============================================

describe('projectsStore.update', () => {
  it('update 成功后覆盖原值', async () => {
    useProjectsStore.getState().setProject(makeProject({ id: 1, name: 'old' }));
    const updated = makeProject({ id: 1, name: 'new' });
    mockedUpdate.mockResolvedValueOnce(updated);

    await useProjectsStore.getState().update(1, { name: 'new' });
    expect(useProjectsStore.getState().selectByID(1)?.name).toBe('new');
  });
});

describe('projectsStore.triggerEvent', () => {
  it('triggerEvent 成功后同步项目状态', async () => {
    useProjectsStore.getState().setProject(makeProject({ id: 1, status: 'dealing' }));
    const post = makeProject({ id: 1, status: 'quoting' });
    mockedTrigger.mockResolvedValueOnce(post);

    await useProjectsStore.getState().triggerEvent(1, {
      event: 'E1',
      remark: '提交报价',
    });
    expect(useProjectsStore.getState().selectByID(1)?.status).toBe('quoting');
    expect(mockedTrigger).toHaveBeenCalledWith(1, {
      event: 'E1',
      remark: '提交报价',
    });
  });

  it('triggerEvent 失败时不修改 store', async () => {
    const before = makeProject({ id: 1, status: 'dealing' });
    useProjectsStore.getState().setProject(before);

    mockedTrigger.mockRejectedValueOnce(new Error('forbidden'));
    await expect(
      useProjectsStore.getState().triggerEvent(1, { event: 'E1', remark: 'x' }),
    ).rejects.toThrow('forbidden');
    expect(useProjectsStore.getState().selectByID(1)).toEqual(before);
  });
});
