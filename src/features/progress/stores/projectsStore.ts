/**
 * @file projectsStore.ts
 * @description 进度模块项目 store —— 用 Map<projectID, Project> 存储以便 O(1) 按 id 查找。
 *
 *              业务背景：
 *              - 项目的看板/列表/详情都需要按 id 拿单条；用数组每次 .find 是 O(n)
 *              - 触发事件后只更新单条，Map.set(id, newProject) 比数组替换快且语义清晰
 *              - selectByID / selectAll 提供两种视角；UI 按需取
 *
 *              数据流：
 *              - load(): GET /api/projects → 全量替换 store
 *              - loadOne(id): GET /api/projects/{id} → 单条覆盖
 *              - create(input): POST → 自动 setProject 到 store
 *              - update(id, input): PATCH → 自动 setProject
 *              - trigger(id, input): POST events → 自动 setProject（推进后状态）
 *
 *              错误处理：失败暴露给 caller（throw），store 不存最近 error
 *              （UI 通过 try/catch 自行处理 Toast，store 保持纯净）
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { create } from 'zustand';

import {
  createProject as apiCreateProject,
  getProject as apiGetProject,
  listProjects as apiListProjects,
  triggerProjectEvent as apiTriggerEvent,
  updateProject as apiUpdateProject,
  type CreateProjectInput,
  type Project,
  type ProjectStatus,
  type TriggerEventInput,
  type UpdateProjectInput,
} from '../api/projects';

// ============================================
// store state
// ============================================

interface ProjectsState {
  /** projectId → Project 映射；未加载状态为 null（与"加载完空数组"区分） */
  projects: Map<number, Project>;
  /** 当前是否正在 load 全量列表 */
  loading: boolean;
  /** 最近一次 load 的 status filter（用于刷新时复用） */
  lastStatusFilter: ProjectStatus | null;

  // ============ derive helpers ============
  selectByID: (id: number) => Project | undefined;
  selectAll: () => Project[];

  // ============ actions ============

  /** 加载项目列表（按可选 status filter） */
  load: (status?: ProjectStatus) => Promise<void>;
  /** 单条加载（详情页用） */
  loadOne: (id: number) => Promise<Project>;
  /** 创建项目 */
  create: (input: CreateProjectInput) => Promise<Project>;
  /** 更新项目 */
  update: (id: number, input: UpdateProjectInput) => Promise<Project>;
  /** 触发状态机事件 */
  triggerEvent: (id: number, input: TriggerEventInput) => Promise<Project>;
  /** 内部：直接写入单条（暴露给测试） */
  setProject: (project: Project) => void;
  /** 内部：移除单条（删除项目场景；当前 v1 无此 endpoint，预留） */
  removeProject: (id: number) => void;
  /** 重置 store（登出 / 切换账号） */
  clear: () => void;
}

// ============================================
// store 实现
// ============================================

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: new Map<number, Project>(),
  loading: false,
  lastStatusFilter: null,

  selectByID(id: number) {
    return get().projects.get(id);
  },

  selectAll() {
    // Array.from(map.values()) 保留 Map 的插入顺序；这与 backend ORDER BY created_at DESC 一致
    return Array.from(get().projects.values());
  },

  async load(status) {
    set({ loading: true, lastStatusFilter: status ?? null });
    try {
      const projects = await apiListProjects(status);
      const map = new Map<number, Project>();
      for (const p of projects) {
        map.set(p.id, p);
      }
      set({ projects: map, loading: false });
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  async loadOne(id) {
    const p = await apiGetProject(id);
    // 局部更新（不动其它项目）
    const next = new Map(get().projects);
    next.set(id, p);
    set({ projects: next });
    return p;
  },

  async create(input) {
    const p = await apiCreateProject(input);
    const next = new Map(get().projects);
    next.set(p.id, p);
    set({ projects: next });
    return p;
  },

  async update(id, input) {
    const p = await apiUpdateProject(id, input);
    const next = new Map(get().projects);
    next.set(p.id, p);
    set({ projects: next });
    return p;
  },

  async triggerEvent(id, input) {
    const p = await apiTriggerEvent(id, input);
    const next = new Map(get().projects);
    next.set(p.id, p);
    set({ projects: next });
    return p;
  },

  setProject(project) {
    const next = new Map(get().projects);
    next.set(project.id, project);
    set({ projects: next });
  },

  removeProject(id) {
    const next = new Map(get().projects);
    next.delete(id);
    set({ projects: next });
  },

  clear() {
    set({
      projects: new Map<number, Project>(),
      loading: false,
      lastStatusFilter: null,
    });
  },
}));
