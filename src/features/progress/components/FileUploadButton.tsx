/**
 * @file FileUploadButton.tsx
 * @description 文件上传按钮 - input type="file" + 调 filesStore.upload(file)
 *              上传成功后调 onUploadSuccess(fileId) 回调（调用方决定后续操作，
 *              如 createThesisVersion / loadByProject）
 *
 *              注：filesStore.upload 签名仅接受 File 一个参数（见 filesStore.ts），
 *              projectId / kind 由调用方在回调中处理，不传给 upload。
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { useRef, useState, type ReactElement, type ChangeEvent } from 'react';
import styles from '../progress.module.css';
import { useFilesStore } from '../stores/filesStore';

interface FileUploadButtonProps {
  /** 按钮显示文字，默认"上传文件" */
  label?: string;
  /** 上传成功后回调（可选），参数为新文件的 fileId */
  onUploadSuccess?: (fileId: number) => Promise<void>;
  /** 允许的 MIME 类型或扩展名，透传给 input[accept] */
  accept?: string;
}

export function FileUploadButton({
  label = '上传文件',
  onUploadSuccess,
  accept,
}: FileUploadButtonProps): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = useFilesStore((s) => s.upload);

  const handleChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      // ============================================
      // 第一步：上传文件，拿回 FileMetadata
      // ============================================
      const meta = await upload(file);
      // ============================================
      // 第二步：调用方回调（如 createThesisVersion）
      // ============================================
      if (onUploadSuccess) {
        await onUploadSuccess(meta.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      // 重置 input，允许再次选择同一文件
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <input
        ref={inputRef}
        type="file"
        onChange={handleChange}
        style={{ display: 'none' }}
        aria-hidden="true"
        accept={accept}
        data-testid="file-input"
      />
      <button
        type="button"
        className={styles.btn}
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        style={{ padding: '6px 16px', fontSize: 13 }}
      >
        {uploading ? '上传中…' : label}
      </button>
      {error && (
        <span style={{ color: 'var(--red)', fontSize: 12, marginLeft: 8 }}>
          {error}
        </span>
      )}
    </div>
  );
}
