/**
 * @file ThesisVersionUploadDialog.tsx
 * @description 论文版本上传组件 - 两阶段流程：
 *              1) 用户点击"上传论文版本" → 选文件 → 调 uploadFile() 拿 fileMetadata
 *              2) 上传成功后弹 modal 显示文件名 + 备注 textarea + 确认按钮
 *              3) 用户填备注（可空）→ createThesisVersion(projectId, fileId, remark)
 *              4) 成功后回调 onUploaded(versionId)，让父组件 invalidate 列表/时间线
 *
 *              设计决策：
 *              - 不修改 FileUploadButton 接口（其他 caller 无 remark 需求，避免 break）
 *              - 直接复用 progress.module.css 的 .modalOverlay / .modal / .modalHead /
 *                .modalBody / .modalFoot / .field / .btn / .btnPrimary，与 PaymentDialog
 *                / QuoteChangeDialog 保持视觉一致
 *              - 备注空字符串时不传 remark 字段，让后端 OpenAPI 走 optional 路径
 *              - 上传失败 / 创建版本失败均用 .fieldError 行内提示，不冒泡到全局 toast
 *              - Escape 键关闭 modal（与 PaymentDialog 一致）
 *
 * @author Atlas.oi
 * @date 2026-05-03
 */
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactElement,
} from 'react';
import styles from '../progress.module.css';
import {
  createThesisVersion,
  uploadFile,
  type FileMetadata,
} from '../api/files';

const TITLE_ID = 'thesis-version-upload-dialog-title';

interface ThesisVersionUploadDialogProps {
  projectId: number;
  /** 论文版本创建成功后回调（参数为新版本 id），父组件用于 bump 列表 refreshTick + invalidate 时间线 */
  onUploaded?: (versionId: number) => void;
  /** 按钮文字，默认"上传论文版本" */
  label?: string;
}

export function ThesisVersionUploadDialog({
  projectId,
  onUploaded,
  label = '上传论文版本',
}: ThesisVersionUploadDialogProps): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);

  // 上传阶段：file picker → uploadFile() 期间禁用按钮
  const [uploading, setUploading] = useState(false);
  // 上传完成后的文件元数据；非 null 即弹 modal
  const [uploadedFile, setUploadedFile] = useState<FileMetadata | null>(null);
  // 备注 textarea
  const [remark, setRemark] = useState('');
  // createThesisVersion 提交期间禁用确认按钮
  const [submitting, setSubmitting] = useState(false);
  // 错误信息：上传阶段 / 提交阶段共用一个 state（两阶段不并发）
  const [error, setError] = useState<string | null>(null);

  // ============================================
  // Escape 键关闭 modal（仅在 modal 打开时绑定）
  // ============================================
  useEffect(() => {
    if (!uploadedFile) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // 取消提交流程：清空已上传文件 state，让用户回到初始按钮状态
        // 注：文件已实际上传到服务端，但未挂到 thesis_versions 表，作"孤儿文件"留存
        // 这与 FileUploadButton 取消语义一致（v1 不做引用计数清理）
        setUploadedFile(null);
        setRemark('');
        setError(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [uploadedFile]);

  // ============================================
  // 第一阶段：用户选文件后立刻 uploadFile()
  // ============================================
  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const meta = await uploadFile(file);
      setUploadedFile(meta);
      setRemark('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      // 重置 input value，允许再次选择同一文件（取消后重新上传场景）
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  // ============================================
  // 第二阶段：用户填完备注点确认 → createThesisVersion
  // ============================================
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!uploadedFile) return;
    setSubmitting(true);
    setError(null);
    try {
      // 备注 trim 后空字符串 → 不传 remark 字段（让后端走 OpenAPI nullable / 缺省路径）
      const trimmedRemark = remark.trim();
      const version = await createThesisVersion(
        projectId,
        uploadedFile.id,
        trimmedRemark === '' ? undefined : trimmedRemark,
      );
      onUploaded?.(version.id);
      // 关闭 modal & 复位 state
      setUploadedFile(null);
      setRemark('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    setUploadedFile(null);
    setRemark('');
    setError(null);
  };

  return (
    <div style={{ marginBottom: 12 }}>
      {/* 隐藏 file input + 触发按钮：与 FileUploadButton 同款风格 */}
      <input
        ref={inputRef}
        type="file"
        onChange={handleFileChange}
        style={{ display: 'none' }}
        aria-hidden="true"
        accept=".pdf,.doc,.docx"
        data-testid="thesis-version-file-input"
      />
      <button
        type="button"
        className={styles.btn}
        onClick={() => inputRef.current?.click()}
        disabled={uploading || submitting}
        style={{ padding: '6px 16px', fontSize: 13 }}
      >
        {uploading ? '上传中…' : label}
      </button>
      {/* 上传阶段错误：modal 未弹时的错误（uploadFile 失败）行内显示 */}
      {error && !uploadedFile && (
        <span style={{ color: 'var(--red)', fontSize: 12, marginLeft: 8 }}>
          {error}
        </span>
      )}

      {/* 第二阶段 modal：备注输入 */}
      {uploadedFile && (
        <div
          className={`${styles.modalOverlay} ${styles.modalOverlayOpen}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCancel();
          }}
        >
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby={TITLE_ID}
            data-testid="thesis-version-upload-dialog"
          >
            <div className={styles.modalHead}>
              <h3 id={TITLE_ID}>论文版本备注</h3>
              <button
                type="button"
                className={styles.modalClose}
                onClick={handleCancel}
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className={styles.modalBody}>
                {/* 已上传的文件名展示（只读，让用户确认这是要提交的版本） */}
                <div className={styles.field}>
                  <label>已上传文件</label>
                  <div
                    style={{
                      padding: '8px 12px',
                      background: 'var(--panel)',
                      border: '1px solid var(--line)',
                      borderRadius: 6,
                      fontSize: 13,
                      wordBreak: 'break-all',
                    }}
                    data-testid="thesis-version-uploaded-filename"
                  >
                    {uploadedFile.filename}
                  </div>
                </div>
                <div className={styles.field}>
                  <label htmlFor="thesis-version-remark">备注（可选）</label>
                  <textarea
                    id="thesis-version-remark"
                    value={remark}
                    onChange={(e) => setRemark(e.target.value)}
                    placeholder="例如：v1.0 初稿、根据导师意见修改第三章…"
                    autoFocus
                    rows={4}
                  />
                </div>
                {error && <p className={styles.fieldError}>{error}</p>}
              </div>
              <div className={styles.modalFoot}>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={handleCancel}
                  disabled={submitting}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  disabled={submitting}
                >
                  {submitting ? '提交中…' : '确认提交'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
