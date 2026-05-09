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
  /** 增量 patch：把单条 Feedback 加入该 projectId 的列表（已存在同 id 则替换） */
  upsertByProject: (projectId: number, fb: Feedback) => void;
  clear: () => void;
}

export const useFeedbacksStore = create<FeedbacksState>((set, get) => ({
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

  upsertByProject: (projectId, fb) => {
    const byProject = new Map(get().byProject);
    const existing = byProject.get(projectId) ?? [];
    const idx = existing.findIndex((item) => item.id === fb.id);
    const next = idx >= 0
      ? existing.map((item) => item.id === fb.id ? fb : item)
      : [...existing, fb];
    byProject.set(projectId, next);
    set({ byProject });
  },

  clear: () => set({ byProject: new Map(), loadingByProject: new Set(), errorByProject: new Map() }),
}));
