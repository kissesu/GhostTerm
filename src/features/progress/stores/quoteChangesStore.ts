/**
 * @file quoteChangesStore.ts
 * @description 费用变更日志 byProject Map，listQuoteChanges + createQuoteChange
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { create } from 'zustand';
import type { QuoteChange, QuoteChangeCreateRequest } from '../api/quotes';
import { listQuoteChanges, createQuoteChange } from '../api/quotes';

interface QuoteChangesState {
  byProject: Map<number, QuoteChange[]>;
  loadingByProject: Set<number>;
  errorByProject: Map<number, string>;
  loadByProject: (projectId: number) => Promise<void>;
  addQuoteChange: (projectId: number, req: QuoteChangeCreateRequest) => Promise<QuoteChange>;
  clear: () => void;
}

export const useQuoteChangesStore = create<QuoteChangesState>((set, get) => ({
  byProject: new Map(),
  loadingByProject: new Set(),
  errorByProject: new Map(),

  loadByProject: async (projectId) => {
    const loading = new Set(get().loadingByProject);
    loading.add(projectId);
    set({ loadingByProject: loading });
    try {
      const list = await listQuoteChanges(projectId);
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

  addQuoteChange: async (projectId, req) => {
    const change = await createQuoteChange(projectId, req);
    const byProject = new Map(get().byProject);
    const existing = byProject.get(projectId) ?? [];
    byProject.set(projectId, [...existing, change]);
    set({ byProject });
    return change;
  },

  clear: () => set({ byProject: new Map(), loadingByProject: new Set(), errorByProject: new Map() }),
}));
