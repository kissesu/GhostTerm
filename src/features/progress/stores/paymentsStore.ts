/**
 * @file paymentsStore.ts
 * @description 项目收款流水 byProject Map，listProjectPayments + createPayment
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { create } from 'zustand';
import type { Payment, PaymentCreatePayload } from '../api/payments';
import { listProjectPayments, createPayment } from '../api/payments';

interface PaymentsState {
  byProject: Map<number, Payment[]>;
  loadingByProject: Set<number>;
  errorByProject: Map<number, string>;
  loadByProject: (projectId: number) => Promise<void>;
  addPayment: (projectId: number, payload: PaymentCreatePayload) => Promise<Payment>;
  /** 增量 patch：把单条 Payment 加入该 projectId 的列表（已存在同 id 则替换） */
  upsertByProject: (projectId: number, pmt: Payment) => void;
  clear: () => void;
}

export const usePaymentsStore = create<PaymentsState>((set, get) => ({
  byProject: new Map(),
  loadingByProject: new Set(),
  errorByProject: new Map(),

  loadByProject: async (projectId) => {
    // 同一 projectId 已在加载中，直接 return 避免并发覆盖
    if (get().loadingByProject.has(projectId)) return;
    const loading = new Set(get().loadingByProject);
    loading.add(projectId);
    set({ loadingByProject: loading });
    try {
      const list = await listProjectPayments(projectId);
      const byProject = new Map(get().byProject);
      byProject.set(projectId, list);
      const newLoading = new Set(get().loadingByProject);
      newLoading.delete(projectId);
      set({ byProject, loadingByProject: newLoading });
    } catch (e) {
      const errs = new Map(get().errorByProject);
      errs.set(projectId, e instanceof Error ? e.message : String(e));
      const newLoading = new Set(get().loadingByProject);
      newLoading.delete(projectId);
      set({ errorByProject: errs, loadingByProject: newLoading });
    }
  },

  addPayment: async (projectId, payload) => {
    const payment = await createPayment(projectId, payload);
    const byProject = new Map(get().byProject);
    const existing = byProject.get(projectId) ?? [];
    byProject.set(projectId, [...existing, payment]);
    set({ byProject });
    return payment;
  },

  upsertByProject: (projectId, pmt) => {
    const byProject = new Map(get().byProject);
    const existing = byProject.get(projectId) ?? [];
    const idx = existing.findIndex((item) => item.id === pmt.id);
    const next = idx >= 0
      ? existing.map((item) => item.id === pmt.id ? pmt : item)
      : [...existing, pmt];
    byProject.set(projectId, next);
    set({ byProject });
  },

  clear: () => set({ byProject: new Map(), loadingByProject: new Set(), errorByProject: new Map() }),
}));
