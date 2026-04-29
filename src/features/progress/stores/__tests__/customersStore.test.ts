/**
 * @file customersStore.test.ts
 * @description Phase 4 customers store 单测：
 *              - fetchAll 成功 → 写入 customers，loading=false
 *              - fetchAll 失败 → 保留旧 customers，写 error，throw
 *              - create 成功 → prepend 到列表头
 *              - update 成功 → 替换同 id 项；没找到则 append
 *              - clear → 重置全部 state
 *
 *              mock customers API（命名空间 customers.list/create/update）+ ProgressApiError，
 *              不触碰真实 fetch 网络。
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================
// 必须 hoist：mock customers API 模块（store import 它）
// ============================================
vi.mock('../../api/customers', () => ({
  customers: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

// 同时 mock client 的 ProgressApiError（store import 它）
vi.mock('../../api/client', () => ({
  ProgressApiError: class extends Error {
    public readonly status: number;
    public readonly code: string;
    public readonly details?: unknown;
    constructor(status: number, code: string, message: string, details?: unknown) {
      super(message);
      this.name = 'ProgressApiError';
      this.status = status;
      this.code = code;
      this.details = details;
    }
  },
}));

import { customers as customersApi } from '../../api/customers';
import { ProgressApiError } from '../../api/client';
import { useCustomersStore } from '../customersStore';
import type { CustomerPayload } from '../../api/schemas';

const mockedList = vi.mocked(customersApi.list);
const mockedCreate = vi.mocked(customersApi.create);
const mockedUpdate = vi.mocked(customersApi.update);

const customer1: CustomerPayload = {
  id: 1,
  nameWechat: '李四',
  remark: '老客户',
  createdBy: 100,
  createdAt: '2026-04-01T00:00:00Z',
  updatedAt: '2026-04-01T00:00:00Z',
};

const customer2: CustomerPayload = {
  id: 2,
  nameWechat: '王五',
  remark: null,
  createdBy: 100,
  createdAt: '2026-04-02T00:00:00Z',
  updatedAt: '2026-04-02T00:00:00Z',
};

beforeEach(() => {
  // 每个用例前重置 store + mock，避免状态串流
  useCustomersStore.setState({ customers: [], loading: false, error: null });
  mockedList.mockReset();
  mockedCreate.mockReset();
  mockedUpdate.mockReset();
});

// ============================================
// fetchAll
// ============================================
describe('customersStore.fetchAll', () => {
  it('成功 fetchAll 写入 customers + loading=false', async () => {
    mockedList.mockResolvedValueOnce([customer1, customer2]);

    await useCustomersStore.getState().fetchAll();

    const state = useCustomersStore.getState();
    expect(state.customers).toEqual([customer1, customer2]);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('fetchAll 失败时保留旧 customers + 写 error + throw', async () => {
    // 预置旧数据
    useCustomersStore.setState({ customers: [customer1] });

    const apiErr = new ProgressApiError(500, 'internal', '服务器错误');
    mockedList.mockRejectedValueOnce(apiErr);

    await expect(useCustomersStore.getState().fetchAll()).rejects.toBe(apiErr);

    const state = useCustomersStore.getState();
    // 旧数据没被清空（避免 UI 闪空）
    expect(state.customers).toEqual([customer1]);
    expect(state.loading).toBe(false);
    expect(state.error).toBe('服务器错误');
  });

  it('fetchAll 期间 loading = true（中间态）', async () => {
    // 用 deferred pattern 让 mockedList 返回一个手动控制的 Promise
    type Resolver = (v: CustomerPayload[]) => void;
    const deferred: { resolve: Resolver | undefined } = { resolve: undefined };
    mockedList.mockReturnValueOnce(
      new Promise<CustomerPayload[]>((resolve) => {
        deferred.resolve = resolve;
      }),
    );

    const promise = useCustomersStore.getState().fetchAll();
    expect(useCustomersStore.getState().loading).toBe(true);

    // 显式断言 resolve 已被赋值（Promise 构造器同步执行）
    if (!deferred.resolve) throw new Error('resolve fn not captured');
    deferred.resolve([customer1]);
    await promise;
    expect(useCustomersStore.getState().loading).toBe(false);
  });
});

// ============================================
// create
// ============================================
describe('customersStore.create', () => {
  it('成功 create 后 prepend 到列表头', async () => {
    useCustomersStore.setState({ customers: [customer2] });
    const newCustomer: CustomerPayload = {
      id: 3,
      nameWechat: '新客户',
      remark: null,
      createdBy: 100,
      createdAt: '2026-04-03T00:00:00Z',
      updatedAt: '2026-04-03T00:00:00Z',
    };
    mockedCreate.mockResolvedValueOnce(newCustomer);

    const result = await useCustomersStore.getState().create({ nameWechat: '新客户' });

    expect(result).toEqual(newCustomer);
    const state = useCustomersStore.getState();
    // 新客户在最前
    expect(state.customers[0]).toEqual(newCustomer);
    expect(state.customers[1]).toEqual(customer2);
    expect(state.error).toBeNull();
  });

  it('create 失败时写 error 并 throw', async () => {
    const apiErr = new ProgressApiError(422, 'validation_failed', 'nameWechat 必填');
    mockedCreate.mockRejectedValueOnce(apiErr);

    await expect(
      useCustomersStore.getState().create({ nameWechat: '' }),
    ).rejects.toBe(apiErr);

    expect(useCustomersStore.getState().error).toBe('nameWechat 必填');
  });
});

// ============================================
// update
// ============================================
describe('customersStore.update', () => {
  it('成功 update 替换列表中的同 id 项', async () => {
    useCustomersStore.setState({ customers: [customer1, customer2] });
    const updated: CustomerPayload = {
      ...customer1,
      nameWechat: '李四（已更名）',
      updatedAt: '2026-04-05T00:00:00Z',
    };
    mockedUpdate.mockResolvedValueOnce(updated);

    const result = await useCustomersStore.getState().update(1, { nameWechat: '李四（已更名）' });

    expect(result).toEqual(updated);
    const state = useCustomersStore.getState();
    expect(state.customers[0]).toEqual(updated);
    expect(state.customers[1]).toEqual(customer2);
    expect(state.error).toBeNull();
  });

  it('本地缓存没有该 id 时 fallback append（避免吞数据）', async () => {
    useCustomersStore.setState({ customers: [customer1] });
    const updated: CustomerPayload = {
      ...customer2,
      nameWechat: '王五更名',
    };
    mockedUpdate.mockResolvedValueOnce(updated);

    await useCustomersStore.getState().update(2, { nameWechat: '王五更名' });

    const state = useCustomersStore.getState();
    expect(state.customers).toHaveLength(2);
    expect(state.customers[1]).toEqual(updated);
  });

  it('update 失败时写 error 并 throw', async () => {
    const apiErr = new ProgressApiError(404, 'not_found', '客户不存在');
    mockedUpdate.mockRejectedValueOnce(apiErr);

    await expect(
      useCustomersStore.getState().update(999, { nameWechat: '不存在' }),
    ).rejects.toBe(apiErr);

    expect(useCustomersStore.getState().error).toBe('客户不存在');
  });
});

// ============================================
// clear
// ============================================
describe('customersStore.clear', () => {
  it('clear 重置 customers / loading / error', () => {
    useCustomersStore.setState({
      customers: [customer1, customer2],
      loading: true,
      error: 'old-error',
    });
    useCustomersStore.getState().clear();
    const state = useCustomersStore.getState();
    expect(state.customers).toEqual([]);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });
});
