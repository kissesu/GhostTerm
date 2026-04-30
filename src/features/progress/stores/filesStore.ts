/**
 * @file filesStore.ts
 * @description 进度模块文件管理 Zustand store。
 *
 *              缓存策略：
 *                - projectFiles：按 projectId 缓存 ProjectFile[]
 *                - thesisVersions：按 projectId 缓存 ThesisVersion[]
 *                - 不做后台轮询（v1 简化）；用户切到项目页时调 refresh*
 *                - upload 成功后调用方负责 refresh（避免 store 与 server 状态偏移）
 *
 *              加载状态：
 *                - 上传中：uploading[projectId] = true（用于按钮 loading 态）
 *                - 列表加载：loading[projectId] / thesisLoading[projectId] 分别独立
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { create } from 'zustand';

import {
  uploadFile,
  listProjectFiles,
  listThesisVersions,
  createThesisVersion,
  type FileMetadata,
  type ProjectFile,
  type ThesisVersion,
} from '../api/files';

// ============================================================
// state shape
// ============================================================

export interface FilesState {
  /** 项目附件缓存（按 projectId） */
  projectFiles: Record<number, ProjectFile[]>;
  /** 项目附件加载中标志（按 projectId） */
  loading: Record<number, boolean>;

  /** 论文版本缓存（按 projectId） */
  thesisVersions: Record<number, ThesisVersion[]>;
  /** 论文版本加载中（按 projectId） */
  thesisLoading: Record<number, boolean>;

  /** 上传中标志（按 projectId；0 表示无关项目的"裸上传"） */
  uploading: Record<number, boolean>;

  /** 最近一次错误（仅用于 UI toast；不阻塞 store） */
  lastError: string | null;
}

export interface FilesActions {
  /** 上传文件（不绑定项目）；返回 FileMetadata 由调用方决定后续动作 */
  upload: (file: File, projectIdForLoading?: number) => Promise<FileMetadata>;

  /** 拉取项目附件列表，结果写入 projectFiles[projectId] */
  refreshProjectFiles: (projectId: number) => Promise<void>;

  /** 拉取论文版本历史，结果写入 thesisVersions[projectId] */
  refreshThesisVersions: (projectId: number) => Promise<void>;

  /** 上传论文新版本：file → 创建 thesis_version → 刷新列表 */
  uploadNewThesisVersion: (
    projectId: number,
    file: File,
    remark?: string,
  ) => Promise<ThesisVersion>;

  /** 清空 lastError（UI toast 关闭后调用） */
  clearError: () => void;
}

export type FilesStore = FilesState & FilesActions;

// ============================================================
// store
// ============================================================

export const useFilesStore = create<FilesStore>((set, get) => ({
  projectFiles: {},
  loading: {},
  thesisVersions: {},
  thesisLoading: {},
  uploading: {},
  lastError: null,

  upload: async (file, projectIdForLoading) => {
    const key = projectIdForLoading ?? 0;
    set((s) => ({
      uploading: { ...s.uploading, [key]: true },
      lastError: null,
    }));
    try {
      const meta = await uploadFile(file);
      return meta;
    } catch (e) {
      set({ lastError: errMsg(e) });
      throw e;
    } finally {
      set((s) => ({
        uploading: { ...s.uploading, [key]: false },
      }));
    }
  },

  refreshProjectFiles: async (projectId) => {
    set((s) => ({
      loading: { ...s.loading, [projectId]: true },
      lastError: null,
    }));
    try {
      const list = await listProjectFiles(projectId);
      set((s) => ({
        projectFiles: { ...s.projectFiles, [projectId]: list },
      }));
    } catch (e) {
      set({ lastError: errMsg(e) });
      throw e;
    } finally {
      set((s) => ({
        loading: { ...s.loading, [projectId]: false },
      }));
    }
  },

  refreshThesisVersions: async (projectId) => {
    set((s) => ({
      thesisLoading: { ...s.thesisLoading, [projectId]: true },
      lastError: null,
    }));
    try {
      const list = await listThesisVersions(projectId);
      set((s) => ({
        thesisVersions: { ...s.thesisVersions, [projectId]: list },
      }));
    } catch (e) {
      set({ lastError: errMsg(e) });
      throw e;
    } finally {
      set((s) => ({
        thesisLoading: { ...s.thesisLoading, [projectId]: false },
      }));
    }
  },

  uploadNewThesisVersion: async (projectId, file, remark) => {
    const meta = await get().upload(file, projectId);
    const version = await createThesisVersion(projectId, meta.id, remark);
    // 增量插入：已知新版本会插队到列表头（version_no 倒序）
    set((s) => {
      const existing = s.thesisVersions[projectId] ?? [];
      return {
        thesisVersions: {
          ...s.thesisVersions,
          [projectId]: [version, ...existing],
        },
      };
    });
    return version;
  },

  clearError: () => set({ lastError: null }),
}));

/** 把 unknown 错误转成可显示字符串。 */
function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'unknown error';
}
