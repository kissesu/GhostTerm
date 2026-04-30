/**
 * @file quoteChangesStore.ts
 * @description 项目费用变更日志的客户端缓存 store —— Phase 8 Worker E。
 *
 *              数据结构：Map<projectId, QuoteChange[]>
 *              - 不同项目互不干扰
 *              - 同一项目重复 fetch 直接覆盖（不做合并，后端是 source of truth）
 *
 *              典型用法：
 *              - QuoteChangesPanel 组件 mount 时调 fetchByProject(projectId)
 *              - QuoteChangeDialog 提交后调 prepend(projectId, log) 让 UI 即时更新
 *                而不必再发一次 list 请求（性能优化）
 *
 *              并发约束：
 *              - 多个项目并行 fetch 安全（用各自的 projectId 作为 map key）
 *              - 同一项目并发 fetch 由调用方自行去重（推荐 React Query；
 *                本 store 不做 inflight 去重，保持简单）
 *
 *              语义边界（不在本 store 做的事）：
 *              - 不做 401 自动 refresh（client.ts 的全局策略）
 *              - 不做 optimistic UI（提交失败回滚）—— 一旦失败暴露给上层
 *              - 不做"本地编辑"（变更日志一旦创建不可改，UI 永远只读历史）
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { create } from 'zustand';

import { listQuoteChanges, type QuoteChange } from '../api/quotes';

interface QuoteChangesState {
  /**
   * projectId → 费用变更日志数组（按 changed_at ASC 排序，与后端约定一致）
   */
  byProject: Map<number, QuoteChange[]>;

  /** 当前正在 fetch 的项目 id 集合（用于 UI loading 态） */
  loading: Set<number>;

  /** 最近一次 fetch / prepend 的错误信息（每个项目独立） */
  errors: Map<number, string>;

  // ============ actions ============

  /** 拉取项目的费用变更日志，写入 byProject */
  fetchByProject: (projectId: number) => Promise<void>;

  /**
   * 把新创建的日志追加到本地缓存末尾（按 changed_at ASC 排序，新日志时间最大 → 末尾）。
   *
   * 业务背景：QuoteChangeDialog 提交成功后调用，避免 UI 等待重新 list。
   */
  appendLocal: (projectId: number, log: QuoteChange) => void;

  /** 清空指定项目的缓存（切换项目 / 登出时） */
  clear: (projectId: number) => void;

  /** 清空所有项目缓存（登出 / 全局 reset） */
  clearAll: () => void;
}

export const useQuoteChangesStore = create<QuoteChangesState>((set) => ({
  byProject: new Map(),
  loading: new Set(),
  errors: new Map(),

  // ----------------------------------------------------------
  // fetchByProject
  // ----------------------------------------------------------
  async fetchByProject(projectId) {
    // 标记 loading
    set((state) => {
      const loading = new Set(state.loading);
      loading.add(projectId);
      const errors = new Map(state.errors);
      errors.delete(projectId);
      return { loading, errors };
    });

    try {
      const list = await listQuoteChanges(projectId);
      set((state) => {
        const byProject = new Map(state.byProject);
        byProject.set(projectId, list);
        const loading = new Set(state.loading);
        loading.delete(projectId);
        return { byProject, loading };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set((state) => {
        const errors = new Map(state.errors);
        errors.set(projectId, message);
        const loading = new Set(state.loading);
        loading.delete(projectId);
        return { errors, loading };
      });
      // 暴露给上层（UI 可以用 errors 字段；调用方也能 catch）
      throw err;
    }
  },

  // ----------------------------------------------------------
  // appendLocal
  // ----------------------------------------------------------
  appendLocal(projectId, log) {
    set((state) => {
      const existing = state.byProject.get(projectId) ?? [];
      const byProject = new Map(state.byProject);
      // 新日志 changed_at 一般是当前时间 → 末尾追加保持 ASC 顺序；
      // 极少数情况下时钟回退会乱序，UI 显示按 changed_at 排序时仍正确
      byProject.set(projectId, [...existing, log]);
      return { byProject };
    });
  },

  // ----------------------------------------------------------
  // clear
  // ----------------------------------------------------------
  clear(projectId) {
    set((state) => {
      const byProject = new Map(state.byProject);
      byProject.delete(projectId);
      const errors = new Map(state.errors);
      errors.delete(projectId);
      return { byProject, errors };
    });
  },

  // ----------------------------------------------------------
  // clearAll
  // ----------------------------------------------------------
  clearAll() {
    set({
      byProject: new Map(),
      loading: new Set(),
      errors: new Map(),
    });
  },
}));

/**
 * 便利 selector：拿到指定项目的费用变更日志（未 fetch 时返回空数组）。
 *
 * 业务背景：组件中常用 useQuoteChangesStore((s) => s.byProject.get(pid) ?? [])，
 * 抽成 hook 复用减少 lint / typo 风险。
 */
export function useQuoteChangesByProject(projectId: number): QuoteChange[] {
  return useQuoteChangesStore((s) => s.byProject.get(projectId) ?? []);
}
