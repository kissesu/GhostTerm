/**
 * @file projectsStore.ts
 * @description 项目列表 + 详情 + 事件触发；状态用 Map<id, Project> 存储以稳定引用
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { create } from 'zustand';
import type { Project, TriggerEventInput } from '../api/projects';
import { listProjects, getProject, triggerProjectEvent } from '../api/projects';

interface ProjectsState {
  projects: Map<number, Project>;
  loading: boolean;
  /** loadAll/loadOne 的最近错误，UI 可展示重试 */
  loadError: string | null;
  /** triggerEvent 的最近错误（按 projectId 隔离） */
  triggeringByProject: Set<number>;
  triggerErrorByProject: Map<number, string>;
  /** stale response guard：每次 loadAll/loadOne 自增，回调写回时 check */
  loadSeq: number;
  loadAll: () => Promise<void>;
  loadOne: (id: number) => Promise<void>;
  triggerEvent: (id: number, input: TriggerEventInput) => Promise<Project>;
  clearTriggerError: (id: number) => void;
  clear: () => void;
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: new Map(),
  loading: false,
  loadError: null,
  triggeringByProject: new Set(),
  triggerErrorByProject: new Map(),
  loadSeq: 0,

  loadAll: async () => {
    const seq = get().loadSeq + 1;
    set({ loading: true, loadError: null, loadSeq: seq });
    try {
      const list = await listProjects();
      // stale guard: 较新的请求开始后，旧响应不能覆盖
      if (get().loadSeq !== seq) return;
      const map = new Map<number, Project>();
      list.forEach((p) => map.set(p.id, p));
      set({ projects: map, loading: false });
    } catch (e) {
      if (get().loadSeq !== seq) return;
      set({ loadError: e instanceof Error ? e.message : String(e), loading: false });
    }
  },

  loadOne: async (id) => {
    const seq = get().loadSeq + 1;
    set({ loadSeq: seq, loadError: null });
    try {
      const p = await getProject(id);
      if (get().loadSeq !== seq) return;
      const map = new Map(get().projects);
      map.set(p.id, p);
      set({ projects: map });
    } catch (e) {
      if (get().loadSeq !== seq) return;
      const msg = e instanceof Error ? e.message : String(e);
      set({ loadError: msg });
      throw e;
    }
  },

  triggerEvent: async (id, input) => {
    const triggering = new Set(get().triggeringByProject);
    triggering.add(id);
    const errs = new Map(get().triggerErrorByProject);
    errs.delete(id);
    set({ triggeringByProject: triggering, triggerErrorByProject: errs });

    try {
      const updated = await triggerProjectEvent(id, input);
      // 不做乐观更新；只有成功回来才写回 Map（失败时保留原 Map）
      const map = new Map(get().projects);
      map.set(updated.id, updated);
      const newTriggering = new Set(get().triggeringByProject);
      newTriggering.delete(id);
      set({ projects: map, triggeringByProject: newTriggering });
      return updated;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const newErrs = new Map(get().triggerErrorByProject);
      newErrs.set(id, msg);
      const newTriggering = new Set(get().triggeringByProject);
      newTriggering.delete(id);
      set({ triggerErrorByProject: newErrs, triggeringByProject: newTriggering });
      throw e;
    }
  },

  clearTriggerError: (id) => {
    const errs = new Map(get().triggerErrorByProject);
    errs.delete(id);
    set({ triggerErrorByProject: errs });
  },

  clear: () => set({
    projects: new Map(),
    loading: false,
    loadError: null,
    triggeringByProject: new Set(),
    triggerErrorByProject: new Map(),
    loadSeq: 0,
  }),
}));
