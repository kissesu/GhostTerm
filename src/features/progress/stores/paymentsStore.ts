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
  clear: () => void;
}

export const usePaymentsStore = create<PaymentsState>((set, get) => ({
  byProject: new Map(),
  loadingByProject: new Set(),
  errorByProject: new Map(),

  loadByProject: async (projectId) => {
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

  clear: () => set({ byProject: new Map(), loadingByProject: new Set(), errorByProject: new Map() }),
}));
