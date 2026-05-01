/**
 * @file filesStore.ts
 * @description 项目文件存储 - byProject Map，listProjectFiles 取 ProjectFile[]；
 *              upload 使用 uploadFile 上传得到 FileMetadata（API 无直接 uploadProjectFile）
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { create } from 'zustand';
import type { ProjectFile, FileMetadata } from '../api/files';
import { listProjectFiles, uploadFile } from '../api/files';

interface FilesState {
  byProject: Map<number, ProjectFile[]>;
  loadingByProject: Set<number>;
  errorByProject: Map<number, string>;
  loadByProject: (projectId: number) => Promise<void>;
  /**
   * 上传文件（调 POST /api/files）；返回 FileMetadata。
   * 注：上传后文件需关联到项目（由 createThesisVersion 或后端附件接口），
   * filesStore 不自动把结果追加到 byProject（因为没有 ProjectFile 完整结构）。
   * byProject 列表刷新由调用方在 upload 成功后调 loadByProject 实现。
   */
  upload: (file: File) => Promise<FileMetadata>;
  clear: () => void;
}

export const useFilesStore = create<FilesState>((set, get) => ({
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
      const list = await listProjectFiles(projectId);
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

  upload: async (file) => {
    return uploadFile(file);
  },

  clear: () => set({ byProject: new Map(), loadingByProject: new Set(), errorByProject: new Map() }),
}));
