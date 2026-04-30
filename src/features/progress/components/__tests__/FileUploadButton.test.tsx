/**
 * @file FileUploadButton.test.tsx
 * @description FileUploadButton 组件单测。
 *              覆盖：
 *                1. 点击触发 input 选择 → 调 store.upload → 成功调 onUploaded
 *                2. 上传中 disabled + label 改为"上传中…"
 *                3. 错误时显示红字
 *                4. 拖拽：drag-over 状态切换 + drop 触发上传
 *                5. accept / disabled 属性透传
 *
 *              注：不 mock 整个 fetch；mock filesStore 的 upload action。
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { FileUploadButton } from '../FileUploadButton';
import { useFilesStore } from '../../stores/filesStore';

const SAMPLE_META = {
  id: 42,
  uuid: '00000000-0000-0000-0000-000000000042',
  filename: 'thesis.pdf',
  sizeBytes: 1024,
  mimeType: 'application/pdf',
  uploadedBy: 1,
  uploadedAt: '2026-04-29T12:00:00Z',
};

beforeEach(() => {
  // 重置 store（zustand store 在测试间共享实例，必须显式 reset）
  useFilesStore.setState({
    projectFiles: {},
    loading: {},
    thesisVersions: {},
    thesisLoading: {},
    uploading: {},
    lastError: null,
  });
});

// ============================================================
// 1. 点击 → 触发上传
// ============================================================

describe('FileUploadButton', () => {
  it('点击按钮触发文件选择并调用 store.upload', async () => {
    const uploadFn = vi.fn().mockResolvedValue(SAMPLE_META);
    useFilesStore.setState({ upload: uploadFn });

    const onUploaded = vi.fn();
    render(<FileUploadButton onUploaded={onUploaded} />);

    const input = screen.getByTestId('file-upload-input') as HTMLInputElement;
    const file = new File(['hello'], 'thesis.pdf', { type: 'application/pdf' });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(uploadFn).toHaveBeenCalledWith(file, undefined);
    });
    await waitFor(() => {
      expect(onUploaded).toHaveBeenCalledWith(SAMPLE_META);
    });
  });

  it('上传中按钮 disabled 且 label 切换', () => {
    const uploadFn = vi.fn().mockReturnValue(new Promise(() => {})); // 永远 pending
    useFilesStore.setState({ upload: uploadFn, uploading: { 7: true } });

    render(<FileUploadButton onUploaded={vi.fn()} projectIdForLoading={7} />);
    const trigger = screen.getByTestId('file-upload-trigger') as HTMLButtonElement;
    expect(trigger).toBeDisabled();
    expect(trigger.textContent).toContain('上传中');
  });

  it('上传失败显示红字错误', async () => {
    const uploadFn = vi.fn().mockRejectedValue(new Error('mime_not_allowed: text/html'));
    useFilesStore.setState({ upload: uploadFn });

    const onUploaded = vi.fn();
    render(<FileUploadButton onUploaded={onUploaded} />);

    const input = screen.getByTestId('file-upload-input') as HTMLInputElement;
    const file = new File(['<html>'], 'fake.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByTestId('file-upload-error').textContent).toContain('mime_not_allowed');
    });
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it('disabled prop 优先于上传状态', () => {
    useFilesStore.setState({ upload: vi.fn() });
    render(<FileUploadButton onUploaded={vi.fn()} disabled label="禁用" />);
    expect(screen.getByTestId('file-upload-trigger')).toBeDisabled();
  });

  it('accept 属性透传到 input', () => {
    useFilesStore.setState({ upload: vi.fn() });
    render(<FileUploadButton onUploaded={vi.fn()} accept=".pdf,.docx" />);
    const input = screen.getByTestId('file-upload-input') as HTMLInputElement;
    expect(input.accept).toBe('.pdf,.docx');
  });

  // ============================================================
  // 2. 拖拽
  // ============================================================

  it('dragOver 切换 data-drag-over', () => {
    useFilesStore.setState({ upload: vi.fn() });
    render(<FileUploadButton onUploaded={vi.fn()} />);
    const root = screen.getByTestId('file-upload-button');
    expect(root.getAttribute('data-drag-over')).toBe('false');

    fireEvent.dragEnter(root);
    expect(root.getAttribute('data-drag-over')).toBe('true');

    fireEvent.dragLeave(root);
    expect(root.getAttribute('data-drag-over')).toBe('false');
  });

  it('drop 文件触发上传', async () => {
    const uploadFn = vi.fn().mockResolvedValue(SAMPLE_META);
    useFilesStore.setState({ upload: uploadFn });

    const onUploaded = vi.fn();
    render(<FileUploadButton onUploaded={onUploaded} />);

    const root = screen.getByTestId('file-upload-button');
    const file = new File(['x'], 'drop.pdf', { type: 'application/pdf' });
    fireEvent.drop(root, {
      dataTransfer: { files: [file] },
    });

    await waitFor(() => {
      expect(uploadFn).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(onUploaded).toHaveBeenCalledWith(SAMPLE_META);
    });
  });
});
