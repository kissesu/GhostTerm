/**
 * @file filesStore.test.ts
 * @description filesStore 行为契约
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../api/files', () => ({
  listProjectFiles: vi.fn(),
  uploadFile: vi.fn(),
}));

import { useFilesStore } from '../filesStore';
import { listProjectFiles, uploadFile } from '../../api/files';

beforeEach(() => {
  useFilesStore.getState().clear();
  vi.resetAllMocks();
});

describe('filesStore', () => {
  it('loadByProject 写入对应项目的文件列表', async () => {
    const mockFiles = [
      { id: 1, projectId: 10, fileId: 100 } as any,
      { id: 2, projectId: 10, fileId: 101 } as any,
    ];
    vi.mocked(listProjectFiles).mockResolvedValue(mockFiles);
    await useFilesStore.getState().loadByProject(10);
    const list = useFilesStore.getState().byProject.get(10);
    expect(list).toHaveLength(2);
    expect(list?.[0].id).toBe(1);
  });

  it('loadByProject 失败后 errorByProject 有值且 loading 清除', async () => {
    vi.mocked(listProjectFiles).mockRejectedValue(new Error('load failed'));
    await useFilesStore.getState().loadByProject(5);
    expect(useFilesStore.getState().errorByProject.get(5)).toBe('load failed');
    expect(useFilesStore.getState().loadingByProject.has(5)).toBe(false);
  });

  it('upload 调用 uploadFile 并返回 FileMetadata', async () => {
    const mockMeta = { id: 99, name: 'test.pdf', size: 1024 } as any;
    vi.mocked(uploadFile).mockResolvedValue(mockMeta);
    const mockFile = new File(['content'], 'test.pdf', { type: 'application/pdf' });
    const result = await useFilesStore.getState().upload(mockFile);
    expect(result).toEqual(mockMeta);
    expect(uploadFile).toHaveBeenCalledWith(mockFile);
  });

  it('loadByProject 期间 loading 状态正确设置', async () => {
    let resolve!: (v: any[]) => void;
    const p = new Promise<any[]>((res) => { resolve = res; });
    vi.mocked(listProjectFiles).mockReturnValue(p);

    const loadPromise = useFilesStore.getState().loadByProject(3);
    expect(useFilesStore.getState().loadingByProject.has(3)).toBe(true);

    resolve([]);
    await loadPromise;
    expect(useFilesStore.getState().loadingByProject.has(3)).toBe(false);
  });

  it('clear 重置所有状态', () => {
    useFilesStore.setState({
      byProject: new Map([[1, [{ id: 1 } as any]]]),
      errorByProject: new Map([[1, 'err']]),
    });
    useFilesStore.getState().clear();
    expect(useFilesStore.getState().byProject.size).toBe(0);
    expect(useFilesStore.getState().errorByProject.size).toBe(0);
  });
});
