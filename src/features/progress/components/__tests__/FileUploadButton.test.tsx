/**
 * @file FileUploadButton.test.tsx
 * @description FileUploadButton 单测：
 *              触发 file input → upload 被调用 / uploading state /
 *              error 显示 / onUploadSuccess 回调被调用
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { FileUploadButton } from '../FileUploadButton';
import type { FileMetadata } from '../../api/files';

const mockUpload = vi.fn();

vi.mock('../../stores/filesStore', () => ({
  useFilesStore: (selector: (s: object) => unknown) =>
    selector({ upload: mockUpload }),
}));

const fakeMetadata: FileMetadata = {
  id: 42,
  uuid: '00000000-0000-0000-0000-000000000042',
  filename: 'thesis.pdf',
  sizeBytes: 1024,
  mimeType: 'application/pdf',
  uploadedBy: 1,
  uploadedAt: '2026-05-01T00:00:00Z',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('FileUploadButton', () => {
  beforeEach(() => {
    mockUpload.mockResolvedValue(fakeMetadata);
  });

  it('默认显示"上传文件"按钮', () => {
    render(<FileUploadButton />);
    expect(screen.getByRole('button', { name: '上传文件' })).toBeInTheDocument();
  });

  it('label prop 修改按钮文字', () => {
    render(<FileUploadButton label="上传论文" />);
    expect(screen.getByRole('button', { name: '上传论文' })).toBeInTheDocument();
  });

  it('选择文件后触发 store.upload', async () => {
    render(<FileUploadButton />);
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['content'], 'test.pdf', { type: 'application/pdf' });

    await act(async () => {
      await userEvent.upload(input, file);
    });

    expect(mockUpload).toHaveBeenCalledWith(file);
  });

  it('上传成功后调用 onUploadSuccess 并传入 fileId', async () => {
    const onSuccess = vi.fn().mockResolvedValue(undefined);
    render(<FileUploadButton onUploadSuccess={onSuccess} />);
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['content'], 'test.pdf', { type: 'application/pdf' });

    await act(async () => {
      await userEvent.upload(input, file);
    });

    expect(onSuccess).toHaveBeenCalledWith(42);
  });

  it('上传失败时显示错误信息', async () => {
    mockUpload.mockRejectedValue(new Error('网络超时'));
    render(<FileUploadButton />);
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['content'], 'test.pdf', { type: 'application/pdf' });

    await act(async () => {
      await userEvent.upload(input, file);
    });

    expect(await screen.findByText('网络超时')).toBeInTheDocument();
  });

  it('上传完成后按钮恢复可用并重置为默认文字', async () => {
    render(<FileUploadButton />);
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['content'], 'test.pdf', { type: 'application/pdf' });

    await act(async () => {
      await userEvent.upload(input, file);
    });

    // 上传完成后按钮恢复可用
    const btn = screen.getByRole('button', { name: '上传文件' });
    expect(btn).not.toBeDisabled();
  });
});
