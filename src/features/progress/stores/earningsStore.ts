/**
 * @file earningsStore.ts
 * @description 收益概览 summary - 单一对象，load 全量刷新；调 getMyEarnings()
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { create } from 'zustand';
import type { EarningsSummary } from '../api/earnings';
import { getMyEarnings } from '../api/earnings';

interface EarningsState {
  summary: EarningsSummary | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  clear: () => void;
}

export const useEarningsStore = create<EarningsState>((set) => ({
  summary: null,
  loading: false,
  error: null,
  load: async () => {
    set({ loading: true, error: null });
    try {
      const s = await getMyEarnings();
      set({ summary: s, loading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false });
    }
  },
  clear: () => set({ summary: null, loading: false, error: null }),
}));
