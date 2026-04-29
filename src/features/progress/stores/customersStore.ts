/**
 * @file customersStore.ts
 * @description 进度模块客户列表 Zustand store（Phase 4 - Worker A）。
 *
 *              职责：
 *              - 集中持有"当前已知客户列表"，避免每个组件各自 fetch + 状态散落
 *              - 提供 fetchAll / create / update 三个 action，内部调 ../api/customers
 *              - 增量更新本地缓存：create 后 prepend；update 后 replace
 *
 *              不做的事：
 *              - 不做无脑乐观更新（v1 业务量小，等后端响应即可，避免冲突回滚的复杂度）
 *              - 不做轮询：customers 通常由用户操作触发刷新；后续若需要 WS 推送
 *                由 NotificationStore 调本 store 的 patch 方法
 *
 *              错误传递：
 *              - action 把 ProgressApiError 透传给调用方（throw），同时把 err.message
 *                写入 store.error 字段供 UI 全局错误条
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { create } from 'zustand';

import { customers as customersApi } from '../api/customers';
import type {
  CreateCustomerInput,
  UpdateCustomerInput,
} from '../api/customers';
import type { CustomerPayload } from '../api/schemas';
import { ProgressApiError } from '../api/client';

interface ProgressCustomersState {
  /** 当前已知的客户列表（按后端返回顺序，通常 created_at DESC） */
  customers: CustomerPayload[];
  /** fetchAll 是否进行中；UI 可据此显示 loading skeleton */
  loading: boolean;
  /** 最近一次操作的错误（成功路径会清为 null） */
  error: string | null;

  // ============ actions ============

  /** 重新拉全部客户（首次加载或手动刷新） */
  fetchAll: () => Promise<void>;
  /** 创建客户后自动 prepend 到列表头 */
  create: (input: CreateCustomerInput) => Promise<CustomerPayload>;
  /** 更新客户后替换列表中的对应项；找不到时 fallback 追加 */
  update: (id: number, input: UpdateCustomerInput) => Promise<CustomerPayload>;
  /** 清空本地缓存（登出 / 切换用户时调用） */
  clear: () => void;
}

/**
 * 业务流程说明：
 *
 *  fetchAll：
 *   1. 标记 loading = true
 *   2. 调 customers.list() → CustomerPayload[]
 *   3. 写入 store.customers，loading = false
 *   4. 失败 → 保留旧 customers（不清空，避免闪空），写 error，throw
 *
 *  create：
 *   1. 调 customers.create(input) → CustomerPayload
 *   2. set state：customers = [new, ...old]，error = null
 *   3. 返回新客户给调用方（用于 onSave 回调链）
 *
 *  update：
 *   1. 调 customers.update(id, input) → CustomerPayload
 *   2. set state：把同 id 项替换为 new；找不到则 fallback append 到末尾
 *   3. 返回新客户
 */
export const useCustomersStore = create<ProgressCustomersState>((set, get) => ({
  customers: [],
  loading: false,
  error: null,

  // ----------------------------------------------------------
  async fetchAll() {
    set({ loading: true, error: null });
    try {
      const list = await customersApi.list();
      set({ customers: list, loading: false, error: null });
    } catch (err) {
      const msg = err instanceof ProgressApiError ? err.message : String(err);
      set({ loading: false, error: msg });
      throw err;
    }
  },

  // ----------------------------------------------------------
  async create(input) {
    try {
      const created = await customersApi.create(input);
      const oldList = get().customers;
      set({ customers: [created, ...oldList], error: null });
      return created;
    } catch (err) {
      const msg = err instanceof ProgressApiError ? err.message : String(err);
      set({ error: msg });
      throw err;
    }
  },

  // ----------------------------------------------------------
  async update(id, input) {
    try {
      const updated = await customersApi.update(id, input);
      const oldList = get().customers;
      let replaced = false;
      const newList = oldList.map((c) => {
        if (c.id === id) {
          replaced = true;
          return updated;
        }
        return c;
      });
      // 兜底：本地缓存里没有这条 id（fetchAll 还没跑过）→ 追加而不是吞
      if (!replaced) {
        newList.push(updated);
      }
      set({ customers: newList, error: null });
      return updated;
    } catch (err) {
      const msg = err instanceof ProgressApiError ? err.message : String(err);
      set({ error: msg });
      throw err;
    }
  },

  // ----------------------------------------------------------
  clear() {
    set({ customers: [], loading: false, error: null });
  },
}));
