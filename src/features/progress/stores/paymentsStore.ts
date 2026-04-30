/**
 * @file paymentsStore.ts
 * @description 进度模块 payments store（Phase 9 Worker F）。
 *
 *              数据形态：Map<projectID, Payment[]>
 *                - 每个项目的 payment 列表独立缓存
 *                - 切换不同项目时不互相覆盖
 *                - create 后增量插入对应 projectID 的数组（不全量 refetch）
 *
 *              UI 用法：
 *                - PaymentDialog 提交后调 add(...)，Drawer 关闭立即看到新行
 *                - 项目详情页打开时调 fetchForProject(projectID)，幂等
 *
 *              错误暴露：
 *                - error 字段保留最近一次 fetch/create 错误，UI 渲染提示
 *                - 不做"自动重试"或"降级回退"（与项目原则一致）
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { create } from 'zustand';

import { listProjectPayments, createPayment, type Payment, type PaymentCreatePayload } from '../api/payments';
import { ProgressApiError } from '../api/client';

interface PaymentsState {
  /** projectID → 该项目的 payment 列表（按 paidAt DESC，由后端排序） */
  byProject: Map<number, Payment[]>;
  /** 最近一次操作是否在执行中 */
  loading: boolean;
  /** 最近一次错误（成功操作会清空） */
  error: string | null;

  // ============ actions ============

  /** 拉取并替换某项目的 payment 列表 */
  fetchForProject: (projectId: number) => Promise<void>;

  /** 录入一条 payment，成功后增量插入到 byProject[projectId] 头部 */
  create: (projectId: number, payload: PaymentCreatePayload) => Promise<Payment>;

  /** 读取某项目的 payment 列表（未拉取过返回空数组） */
  getForProject: (projectId: number) => Payment[];

  /** 清空所有缓存（登出时调用） */
  clear: () => void;
}

export const usePaymentsStore = create<PaymentsState>((set, get) => ({
  byProject: new Map<number, Payment[]>(),
  loading: false,
  error: null,

  // ----------------------------------------------------------
  // fetchForProject
  // ----------------------------------------------------------
  async fetchForProject(projectId) {
    set({ loading: true, error: null });
    try {
      const list = await listProjectPayments(projectId);
      // 不可变更新：拷一份 Map，避免破坏 zustand 浅比较
      const next = new Map(get().byProject);
      next.set(projectId, list);
      set({ byProject: next, loading: false });
    } catch (err) {
      const msg = err instanceof ProgressApiError ? err.message : String(err);
      set({ loading: false, error: msg });
      throw err;
    }
  },

  // ----------------------------------------------------------
  // create
  // ----------------------------------------------------------
  async create(projectId, payload) {
    set({ loading: true, error: null });
    try {
      const created = await createPayment(projectId, payload);
      const next = new Map(get().byProject);
      const existing = next.get(projectId) ?? [];
      // 后端按 paid_at DESC 排序：新建的"理论上"是最新一笔，放在头部
      next.set(projectId, [created, ...existing]);
      set({ byProject: next, loading: false });
      return created;
    } catch (err) {
      const msg = err instanceof ProgressApiError ? err.message : String(err);
      set({ loading: false, error: msg });
      throw err;
    }
  },

  // ----------------------------------------------------------
  // getForProject
  // ----------------------------------------------------------
  getForProject(projectId) {
    return get().byProject.get(projectId) ?? [];
  },

  // ----------------------------------------------------------
  // clear
  // ----------------------------------------------------------
  clear() {
    set({ byProject: new Map(), loading: false, error: null });
  },
}));
