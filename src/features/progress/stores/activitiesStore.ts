/**
 * @file activitiesStore.ts
 * @description 进度时间线 Zustand store —— Map<projectId, ActivityState>
 *
 *              业务逻辑说明：
 *                1. byProject 是 projectId → ActivityState 的映射，避免不同项目互相
 *                   污染；多项目并存时 selector 直接 .get(pid) 读对应分桶
 *                2. loadActivities(pid) 不传 cursor 时整桶替换（首次或刷新）；
 *                   传 cursor 时 append 并按 id 去重，应对同一活动同时出现在两次
 *                   分页响应（可能性低，但 RDS race condition 时仍要兜底）
 *                3. invalidate(pid) 清空 + 立即拉首页（用户主动刷新或某活动被删除时调用）
 *                4. 错误路径设置 error 字符串、清 loading；不抛出，让 UI 决定渲染
 *
 *              不做的事：
 *                - 不做轮询（detail 页用 WS 增量；store 只接收手动 load）
 *                - 不做 selector hook（DetailTimeline 用 useActivitiesStore 直接选）
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { create } from 'zustand';

import type { Activity } from '../api/activities';
import { getActivities } from '../api/activities';

/** 单个项目维度的时间线状态 */
export interface ActivityState {
  items: Activity[];
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
}

interface ActivitiesStore {
  byProject: Map<number, ActivityState>;
  /**
   * 加载某项目时间线。不传 cursor 整桶替换；传 cursor 则在末尾 append 并去重。
   */
  loadActivities: (projectId: number, cursor?: string) => Promise<void>;
  /** 清空指定项目状态 + 立即重新拉首页 */
  invalidate: (projectId: number) => Promise<void>;
}

// 单项目初始空状态；用 const 共享避免每次 new 对象
const emptyState: ActivityState = {
  items: [],
  nextCursor: null,
  loading: false,
  error: null,
};

export const useActivitiesStore = create<ActivitiesStore>((set, get) => ({
  byProject: new Map(),

  loadActivities: async (projectId, cursor) => {
    // 第一步：标记 loading（保留旧 items，避免 UI 闪空）
    const prev = get().byProject.get(projectId) ?? emptyState;
    set((s) => {
      const next = new Map(s.byProject);
      next.set(projectId, { ...prev, loading: true, error: null });
      return { byProject: next };
    });

    try {
      // 第二步：调 API
      const { items, nextCursor } = await getActivities(projectId, cursor);

      // 第三步：合并 —— cursor 存在时 append + 去重；否则整桶替换
      set((s) => {
        const next = new Map(s.byProject);
        const current = next.get(projectId) ?? emptyState;
        const merged = cursor ? dedupeById([...current.items, ...items]) : items;
        next.set(projectId, {
          items: merged,
          nextCursor,
          loading: false,
          error: null,
        });
        return { byProject: next };
      });
    } catch (e) {
      // 第四步：错误分支 —— 清 loading、设 error；items 保持现状
      const msg = e instanceof Error ? e.message : String(e);
      set((s) => {
        const next = new Map(s.byProject);
        const current = next.get(projectId) ?? emptyState;
        next.set(projectId, { ...current, loading: false, error: msg });
        return { byProject: next };
      });
    }
  },

  invalidate: async (projectId) => {
    // 清空对应项目状态 → 立即触发首页拉取
    set((s) => {
      const next = new Map(s.byProject);
      next.set(projectId, emptyState);
      return { byProject: next };
    });
    await get().loadActivities(projectId);
  },
}));

/**
 * 按 Activity.id 去重（id 形如 'kind:sourceId' 后端保证全局唯一）。
 *
 * 保留首次出现的元素，后续同 id 跳过，时间序由后端 DESC 排序兜底。
 */
function dedupeById(items: Activity[]): Activity[] {
  const seen = new Set<string>();
  const out: Activity[] = [];
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}
