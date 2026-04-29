/**
 * @file ThesisVersionList.test.tsx
 * @description ThesisVersionList 组件单测。
 *              覆盖：
 *                1. 加载中显示 loading；空列表显示 empty
 *                2. 多个版本按 version_no 倒序展示（最新在前）
 *                3. canUpload=false 时不显示上传 UI
 *                4. 选文件 → 填 remark → 确认 → 调 store.uploadNewThesisVersion
 *                5. 取消按钮清除 pending 状态
 *                6. 下载按钮调用 downloadFile（mock 后断言被调用）
 *
 *              不 mock fetch；mock store action + api/files.ts 的 downloadFile。
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// 必须先 mock 再 import
vi.mock('../../api/files', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../api/files');
  return {
    ...actual,
    downloadFile: vi.fn().mockResolvedValue(undefined),
    uploadFile: vi.fn(),
    listProjectFiles: vi.fn(),
    listThesisVersions: vi.fn(),
    createThesisVersion: vi.fn(),
  };
});

import { ThesisVersionList } from '../ThesisVersionList';
import { useFilesStore } from '../../stores/filesStore';
import { downloadFile } from '../../api/files';

const SAMPLE_FILE_META = {
  id: 100,
  uuid: '00000000-0000-0000-0000-000000000100',
  filename: 'thesis-v3.pdf',
  sizeBytes: 1024,
  mimeType: 'application/pdf',
  uploadedBy: 1,
  uploadedAt: '2026-04-29T10:00:00Z',
};

const V1 = {
  id: 1,
  projectId: 5,
  fileId: 11,
  versionNo: 1,
  remark: '初稿',
  uploadedBy: 1,
  uploadedAt: '2026-04-29T08:00:00Z',
  file: { ...SAMPLE_FILE_META, id: 11, filename: 'thesis-v1.pdf' },
};
const V2 = {
  id: 2,
  projectId: 5,
  fileId: 12,
  versionNo: 2,
  remark: null,
  uploadedBy: 1,
  uploadedAt: '2026-04-29T09:00:00Z',
  file: { ...SAMPLE_FILE_META, id: 12, filename: 'thesis-v2.pdf' },
};

beforeEach(() => {
  useFilesStore.setState({
    projectFiles: {},
    loading: {},
    thesisVersions: {},
    thesisLoading: {},
    uploading: {},
    lastError: null,
  });
  vi.mocked(downloadFile).mockClear().mockResolvedValue(undefined);
});

describe('ThesisVersionList', () => {
  it('加载中显示 loading 文案', () => {
    useFilesStore.setState({
      thesisLoading: { 5: true },
      refreshThesisVersions: vi.fn().mockResolvedValue(undefined),
    });
    render(<ThesisVersionList projectId={5} />);
    expect(screen.getByTestId('thesis-loading')).toBeTruthy();
  });

  it('无版本时显示 empty 占位', async () => {
    useFilesStore.setState({
      thesisVersions: { 5: [] },
      thesisLoading: { 5: false },
      refreshThesisVersions: vi.fn().mockResolvedValue(undefined),
    });
    render(<ThesisVersionList projectId={5} />);
    expect(screen.getByTestId('thesis-empty')).toBeTruthy();
  });

  it('多个版本按倒序展示（v2 在 v1 之前）', () => {
    useFilesStore.setState({
      thesisVersions: { 5: [V2, V1] }, // store 已按倒序传入
      refreshThesisVersions: vi.fn().mockResolvedValue(undefined),
    });
    render(<ThesisVersionList projectId={5} />);

    const items = screen.getAllByTestId(/^thesis-version-row-/);
    expect(items).toHaveLength(2);
    // 第一行是 v2
    expect(items[0].getAttribute('data-version-no')).toBe('2');
    expect(items[1].getAttribute('data-version-no')).toBe('1');
  });

  it('canUpload=false 时不渲染选文件按钮', () => {
    useFilesStore.setState({
      thesisVersions: { 5: [] },
      refreshThesisVersions: vi.fn().mockResolvedValue(undefined),
    });
    render(<ThesisVersionList projectId={5} canUpload={false} />);
    expect(screen.queryByTestId('thesis-file-picker')).toBeNull();
  });

  it('选文件 → 显示确认面板 → 填 remark → 确认调用 store action', async () => {
    const uploadAction = vi.fn().mockResolvedValue({ ...V2, versionNo: 3 });
    useFilesStore.setState({
      thesisVersions: { 5: [V2, V1] },
      refreshThesisVersions: vi.fn().mockResolvedValue(undefined),
      uploadNewThesisVersion: uploadAction,
    });
    render(<ThesisVersionList projectId={5} />);

    // 触发文件选择
    const input = screen.getByTestId('thesis-file-input') as HTMLInputElement;
    const file = new File(['x'], 'thesis-v3.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });

    // 确认面板出现
    await waitFor(() => {
      expect(screen.getByTestId('thesis-confirm-panel')).toBeTruthy();
    });

    // 填 remark
    const remarkInput = screen.getByTestId('thesis-remark-input') as HTMLInputElement;
    fireEvent.change(remarkInput, { target: { value: '终稿' } });

    // 点确认
    fireEvent.click(screen.getByTestId('thesis-confirm-btn'));

    await waitFor(() => {
      expect(uploadAction).toHaveBeenCalledWith(5, file, '终稿');
    });
  });

  it('取消按钮清除 pending 文件', async () => {
    useFilesStore.setState({
      thesisVersions: { 5: [] },
      refreshThesisVersions: vi.fn().mockResolvedValue(undefined),
    });
    render(<ThesisVersionList projectId={5} />);

    const input = screen.getByTestId('thesis-file-input') as HTMLInputElement;
    const file = new File(['x'], 'pick.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByTestId('thesis-confirm-panel')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('thesis-cancel-btn'));

    await waitFor(() => {
      expect(screen.queryByTestId('thesis-confirm-panel')).toBeNull();
    });
  });

  it('下载按钮触发 downloadFile API', async () => {
    useFilesStore.setState({
      thesisVersions: { 5: [V2] },
      refreshThesisVersions: vi.fn().mockResolvedValue(undefined),
    });
    render(<ThesisVersionList projectId={5} />);

    fireEvent.click(screen.getByTestId('thesis-download-2'));

    await waitFor(() => {
      expect(vi.mocked(downloadFile)).toHaveBeenCalledWith(12, 'thesis-v2.pdf');
    });
  });

  it('mount 时自动调 refreshThesisVersions', () => {
    const refreshFn = vi.fn().mockResolvedValue(undefined);
    useFilesStore.setState({
      thesisVersions: { 5: [] },
      refreshThesisVersions: refreshFn,
    });
    render(<ThesisVersionList projectId={5} />);
    expect(refreshFn).toHaveBeenCalledWith(5);
  });
});
