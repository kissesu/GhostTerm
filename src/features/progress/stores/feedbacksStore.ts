/**
 * @file feedbacksStore.ts
 * @description 反馈系统的 Zustand store（Phase 7 Worker D）。
 *
 *              数据形状：byProject: Map<projectId, Feedback[]>
 *                - 每个项目独立缓存，切换项目时不互相清理（per-project state isolation
 *                  套用 GhostTerm 主项目的"feedback_per_project_state_isolation"经验）
 *                - 同一 projectId 多次 load → 用最新结果整体替换，不增量合并
 *
 *              Action 列表：
 *                - load(projectId)            列表拉取
 *                - create(projectId, input)   录入新反馈，成功后 append 到 byProject[projectId]
 *                - updateStatus(feedbackId, status) 更新状态后替换 byProject 中对应行
 *                - clear()                    登出 / 切用户时全清
 *
 *              语义边界：
 *              - 不在 store 做权限判定（PermissionGate 负责 UI 守卫，后端 RBAC 兜底）
 *              - 不做错误重试 / 降级：错误暴露给 UI 显示，由用户决定下一步
 *              - loadingByProject / errorByProject：分项目维度，避免 A 项目 loading 阻塞 B 项目 UI
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { create } from 'zustand';

import {
  createFeedback as apiCreateFeedback,
  listFeedbacks as apiListFeedbacks,
  updateFeedback as apiUpdateFeedback,
  type CreateFeedbackInput,
  type Feedback,
  type FeedbackStatus,
} from '../api/feedbacks';
import { ProgressApiError } from '../api/client';

interface FeedbacksState {
  /** 按 projectId 分桶缓存反馈列表 */
  byProject: Map<number, Feedback[]>;

  /** 当前正在加载的 projectId 集合（UI 展示 loading 占位） */
  loadingByProject: Set<number>;

  /** 各项目最近一次操作的错误消息；项目切换时不主动清除（让用户能回看错误） */
  errorByProject: Map<number, string>;

  // ============ actions ============

  /** 拉取项目下反馈列表，写入 byProject[projectId] */
  load: (projectId: number) => Promise<void>;

  /** 录入新反馈；成功后 append 到 byProject[projectId] 末尾（保持 ASC 时间序） */
  create: (projectId: number, input: CreateFeedbackInput) => Promise<Feedback>;

  /**
   * 更新反馈 status；成功后替换 byProject 中对应 feedback。
   * 因为 store 不知道 feedback 来自哪个 project，必须遍历 byProject 找到目标行替换。
   */
  updateStatus: (feedbackId: number, status: FeedbackStatus) => Promise<Feedback>;

  /** 同步选择器：取某项目的反馈列表（未加载时返回空数组） */
  getByProject: (projectId: number) => Feedback[];

  /** 同步选择器：取某项目的 loading 状态 */
  isLoading: (projectId: number) => boolean;

  /** 同步选择器：取某项目的错误信息 */
  getError: (projectId: number) => string | null;

  /** 清空所有缓存（登出 / 切用户调用） */
  clear: () => void;
}

export const useFeedbacksStore = create<FeedbacksState>((set, get) => ({
  byProject: new Map(),
  loadingByProject: new Set(),
  errorByProject: new Map(),

  // ----------------------------------------------------------
  // load
  // ----------------------------------------------------------
  async load(projectId) {
    // 标记 loading（创建新 Set，避免 zustand 同引用问题）
    set((state) => {
      const next = new Set(state.loadingByProject);
      next.add(projectId);
      const errs = new Map(state.errorByProject);
      errs.delete(projectId);
      return { loadingByProject: next, errorByProject: errs };
    });

    try {
      const list = await apiListFeedbacks(projectId);
      set((state) => {
        const next = new Map(state.byProject);
        next.set(projectId, list);
        const loading = new Set(state.loadingByProject);
        loading.delete(projectId);
        return { byProject: next, loadingByProject: loading };
      });
    } catch (err) {
      const msg = err instanceof ProgressApiError ? err.message : String(err);
      set((state) => {
        const loading = new Set(state.loadingByProject);
        loading.delete(projectId);
        const errs = new Map(state.errorByProject);
        errs.set(projectId, msg);
        return { loadingByProject: loading, errorByProject: errs };
      });
      throw err;
    }
  },

  // ----------------------------------------------------------
  // create
  // ----------------------------------------------------------
  async create(projectId, input) {
    try {
      const fb = await apiCreateFeedback(projectId, input);
      set((state) => {
        const next = new Map(state.byProject);
        const prev = next.get(projectId) ?? [];
        // 时间序追加；后端 RETURNING recordedAt 必然 >= prev 末尾
        next.set(projectId, [...prev, fb]);
        // 创建成功清错误
        const errs = new Map(state.errorByProject);
        errs.delete(projectId);
        return { byProject: next, errorByProject: errs };
      });
      return fb;
    } catch (err) {
      const msg = err instanceof ProgressApiError ? err.message : String(err);
      set((state) => {
        const errs = new Map(state.errorByProject);
        errs.set(projectId, msg);
        return { errorByProject: errs };
      });
      throw err;
    }
  },

  // ----------------------------------------------------------
  // updateStatus
  // ----------------------------------------------------------
  async updateStatus(feedbackId, status) {
    const fb = await apiUpdateFeedback(feedbackId, { status });
    set((state) => {
      const next = new Map(state.byProject);
      // 找到包含该 feedbackId 的项目桶，替换对应行
      for (const [pid, list] of next.entries()) {
        const idx = list.findIndex((item) => item.id === feedbackId);
        if (idx >= 0) {
          const updated = [...list];
          updated[idx] = fb;
          next.set(pid, updated);
          break;
        }
      }
      // 如果之前没缓存（刷新页面后直接更新某条），把它放到对应 project 桶
      if (!Array.from(next.values()).some((list) => list.some((i) => i.id === feedbackId))) {
        const prev = next.get(fb.projectId) ?? [];
        next.set(fb.projectId, [...prev, fb]);
      }
      return { byProject: next };
    });
    return fb;
  },

  // ----------------------------------------------------------
  // selectors
  // ----------------------------------------------------------
  getByProject(projectId) {
    return get().byProject.get(projectId) ?? [];
  },
  isLoading(projectId) {
    return get().loadingByProject.has(projectId);
  },
  getError(projectId) {
    return get().errorByProject.get(projectId) ?? null;
  },

  // ----------------------------------------------------------
  // clear
  // ----------------------------------------------------------
  clear() {
    set({
      byProject: new Map(),
      loadingByProject: new Set(),
      errorByProject: new Map(),
    });
  },
}));
