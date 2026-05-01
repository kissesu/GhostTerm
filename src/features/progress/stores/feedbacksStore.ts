/**
 * @file feedbacksStore.ts
 * @description 反馈列表 byProject Map ASC 时间序，最末为最新；
 *              recordedAt 是时间排序字段（§1.5 字段约定）
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { create } from 'zustand';
import type { Feedback, CreateFeedbackInput } from '../api/feedbacks';
import { listFeedbacks, createFeedback } from '../api/feedbacks';

interface FeedbacksState {
  byProject: Map<number, Feedback[]>;
  loadingByProject: Set<number>;
  errorByProject: Map<number, string>;
  loadByProject: (projectId: number) => Promise<void>;
  add: (projectId: number, input: CreateFeedbackInput) => Promise<Feedback>;
  clear: () => void;
}

export const useFeedbacksStore = create<FeedbacksState>((set, get) => ({
  byProject: new Map(),
  loadingByProject: new Set(),
  errorByProject: new Map(),

  loadByProject: async (projectId) => {
    const loading = new Set(get().loadingByProject);
    loading.add(projectId);
    set({ loadingByProject: loading });
    try {
      const list = await listFeedbacks(projectId);
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

  add: async (projectId, input) => {
    const fb = await createFeedback(projectId, input);
    const byProject = new Map(get().byProject);
    const existing = byProject.get(projectId) ?? [];
    byProject.set(projectId, [...existing, fb]);
    set({ byProject });
    return fb;
  },

  clear: () => set({ byProject: new Map(), loadingByProject: new Set(), errorByProject: new Map() }),
}));
