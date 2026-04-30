/**
 * @file FileUploadButton.tsx
 * @description 通用文件上传按钮 + 拖拽区域。
 *
 *              业务背景：
 *              - spec §9 文件管理需要给"项目附件" / "论文新版本" / "反馈截图"等多处复用
 *              - 不绑定项目 ID 自身：上传成功 → onUploaded(fileId) 回调让调用方决定后续
 *                （Attach 到项目 / 创建 ThesisVersion / 加到 feedback 等）
 *              - 拖拽 + 点击两种入口：dragOver 状态用 useState 不写 store（局部 UI 状态）
 *
 *              错误显示：上传失败时把 ProgressApiError.message 渲染到组件下方红字。
 *              不靠 toast：组件复用层不假定有全局 toast；调用方需要 toast 自己消费 store.lastError。
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';

import { useFilesStore } from '../stores/filesStore';
import type { FileMetadata } from '../api/files';

export interface FileUploadButtonProps {
  /** 上传成功回调，参数是后端返回的文件元数据 */
  onUploaded: (file: FileMetadata) => void;
  /** 按钮 label，默认"上传文件" */
  label?: string;
  /** 关联项目 ID（仅用于 store 内的 uploading 标志区分） */
  projectIdForLoading?: number;
  /** input accept 属性（如 ".pdf,.docx"），默认放开所有 */
  accept?: string;
  /** 是否禁用整个组件 */
  disabled?: boolean;
}

export function FileUploadButton({
  onUploaded,
  label = '上传文件',
  projectIdForLoading,
  accept,
  disabled = false,
}: FileUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const upload = useFilesStore((s) => s.upload);
  const uploading = useFilesStore(
    (s) => s.uploading[projectIdForLoading ?? 0] ?? false,
  );

  const isDisabled = disabled || uploading;

  // ============================================
  // 第一步：上传单个 File（点击 / 拖拽 共用）
  // ============================================
  const handleUpload = async (file: File): Promise<void> => {
    setLocalError(null);
    try {
      const meta = await upload(file, projectIdForLoading);
      onUploaded(meta);
    } catch (e) {
      // store.lastError 已写；本地也写一份避免组件复用时其它实例读串
      setLocalError(e instanceof Error ? e.message : '上传失败');
    }
  };

  // ============================================
  // 第二步：input 选择
  // ============================================
  const handleInputChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;
    void handleUpload(file);
    // reset value 让重复选同一文件也能触发 onChange
    e.target.value = '';
  };

  // ============================================
  // 第三步：拖拽
  // ============================================
  const handleDragEnter = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    if (!isDisabled) setDragOver(true);
  };
  const handleDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragOver(false);
  };
  const handleDragOver = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault(); // 允许 drop
  };
  const handleDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragOver(false);
    if (isDisabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleUpload(file);
    }
  };

  return (
    <div
      data-testid="file-upload-button"
      data-drag-over={dragOver ? 'true' : 'false'}
      data-uploading={uploading ? 'true' : 'false'}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{
        border: dragOver ? '1px dashed var(--accent)' : '1px dashed var(--line)',
        background: dragOver ? 'rgba(184, 255, 106, 0.06)' : 'var(--panel)',
        padding: 14,
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        transition: 'border-color 120ms ease, background 120ms ease',
      }}
    >
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={isDisabled}
        data-testid="file-upload-trigger"
        aria-label={label}
        style={{
          height: 32,
          padding: '0 14px',
          borderRadius: 6,
          border: '1px solid var(--line)',
          background: '#11110f',
          color: isDisabled ? 'var(--faint)' : 'var(--text)',
          cursor: isDisabled ? 'not-allowed' : 'pointer',
          fontSize: 12,
          fontWeight: 800,
          fontFamily: 'inherit',
          alignSelf: 'flex-start',
          opacity: isDisabled ? 0.6 : 1,
        }}
      >
        {uploading ? '上传中…' : label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleInputChange}
        style={{ display: 'none' }}
        data-testid="file-upload-input"
      />
      {localError !== null && (
        <div
          data-testid="file-upload-error"
          style={{
            padding: '6px 10px',
            border: '1px solid rgba(239, 104, 98, 0.4)',
            borderRadius: 6,
            background: 'rgba(239, 104, 98, 0.1)',
            color: '#ffd8d4',
            fontSize: 12,
          }}
          role="alert"
        >
          {localError}
        </div>
      )}
      {dragOver && (
        <div data-testid="file-upload-drag-hint" style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>
          松开鼠标完成上传
        </div>
      )}
    </div>
  );
}
