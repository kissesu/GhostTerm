/**
 * @file PaymentDialog.tsx
 * @description 新增收款记录弹窗 - 复用 progress.module.css modalOverlay / modal / field
 *              字段：金额 + 方式（remark）+ 备注；提交调 paymentsStore.addPayment
 *
 *              direction 固定 customer_in（客户入账），paidAt 取当前时间，
 *              remark 合并"方式：备注"便于后续搜索。
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { useState, useEffect, useRef, type ReactElement, type FormEvent, type ChangeEvent } from 'react';
import styles from '../progress.module.css';
import { usePaymentsStore } from '../stores/paymentsStore';
import { uploadFile } from '../api/files';

const METHODS = ['支付宝', '微信', '银行转账', '现金', '其他'] as const;
type Method = typeof METHODS[number];

const TITLE_ID = 'payment-dialog-title';

interface PaymentDialogProps {
  projectId: number;
  onClose: () => void;
  onSuccess?: () => void;
}

export function PaymentDialog({
  projectId,
  onClose,
  onSuccess,
}: PaymentDialogProps): ReactElement {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<Method>('支付宝');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 凭证截图附件（用户反馈 2026-05-03"结算弹窗没有上传截图的入口"）
  // - 多文件 + 即时 uploadFile 拿 fileId，attachments 累积；提交时把 ids 传给 addPayment
  // - 模式与 FeedbackInput 一致（allSettled + chip 列表 + 移除按钮）
  const [attachments, setAttachments] = useState<{ id: number; filename: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const addPayment = usePaymentsStore((s) => s.addPayment);

  // Escape 键关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = amount.trim();
    const parsed = Number(trimmed);
    if (!trimmed || !Number.isFinite(parsed) || parsed <= 0) {
      setError('请输入有效金额');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // ============================================
      // 构造符合 PaymentCreatePayload 类型的请求体：
      // - direction: 固定 customer_in（本弹窗仅用于客户收款）
      // - amount: Money 字符串，OAS pattern 强制 2 位小数（^-?\d+\.\d{2}$），
      //          必须 toFixed(2) 归一让 "500" → "500.00"，
      //          否则后端 ogen 解码阶段 500（与 QuoteChangeDialog 同一约定）
      // - paidAt: 当前 ISO datetime
      // - remark: "方式：备注" 拼接，便于后续检索
      // ============================================
      const remark = note.trim() ? `${method}：${note.trim()}` : method;
      const attachmentIds = attachments.map((a) => a.id);
      await addPayment(projectId, {
        direction: 'customer_in',
        amount: parsed.toFixed(2),
        paidAt: new Date().toISOString(),
        remark,
        ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
      });
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  // 多文件上传：复用 FeedbackInput allSettled 模式（单文件失败不阻断其它）
  const handleFilesPicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setUploading(true);
    setUploadErrors([]);
    const results = await Promise.allSettled(files.map((f) => uploadFile(f)));
    const ok: { id: number; filename: string }[] = [];
    const fail: string[] = [];
    results.forEach((r, idx) => {
      const f = files[idx];
      if (r.status === 'fulfilled') {
        ok.push({ id: r.value.id, filename: r.value.filename });
      } else {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        fail.push(`${f.name}：${msg}`);
      }
    });
    if (ok.length > 0) setAttachments((prev) => [...prev, ...ok]);
    if (fail.length > 0) setUploadErrors(fail);
    setUploading(false);
  };

  const removeAttachment = (id: number) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  return (
    <div
      className={`${styles.modalOverlay} ${styles.modalOverlayOpen}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        data-testid="payment-dialog"
      >
        <div className={styles.modalHead}>
          <h3 id={TITLE_ID}>新增结算</h3>
          <button
            type="button"
            className={styles.modalClose}
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className={styles.modalBody}>
            <div className={styles.field}>
              <label htmlFor="payment-amount">结算金额（¥） *</label>
              <input
                id="payment-amount"
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="payment-method">支付方式</label>
              <select
                id="payment-method"
                value={method}
                onChange={(e) => setMethod(e.target.value as Method)}
              >
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="payment-note">备注</label>
              <textarea
                id="payment-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            {/* 凭证截图：用户反馈 2026-05-03"结算弹窗没有上传截图的入口" */}
            <div className={styles.field}>
              <label>凭证截图（可选，可多选）</label>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,application/pdf"
                aria-label="选择凭证截图"
                style={{ display: 'none' }}
                onChange={handleFilesPicked}
                data-testid="payment-attachment-input"
              />
              <button
                type="button"
                className={styles.btn}
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || submitting}
                style={{ padding: '4px 12px', fontSize: 12 }}
              >
                {uploading ? '上传中…' : '+ 添加凭证'}
              </button>
              {attachments.length > 0 && (
                <div className={styles.docUploadList} aria-label="凭证列表" style={{ marginTop: 8 }}>
                  {attachments.map((a) => (
                    <span key={a.id} className={styles.docUploadChip}>
                      {a.filename}
                      <button
                        type="button"
                        onClick={() => removeAttachment(a.id)}
                        aria-label={`移除 ${a.filename}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {uploadErrors.length > 0 && (
                <ul style={{ marginTop: 8, paddingLeft: 16, color: 'var(--red)', fontSize: 12 }}>
                  {uploadErrors.map((msg, i) => (
                    <li key={i}>{msg}</li>
                  ))}
                </ul>
              )}
            </div>
            {error && <p className={styles.fieldError}>{error}</p>}
          </div>
          <div className={styles.modalFoot}>
            <button type="button" className={styles.btn} onClick={onClose}>
              取消
            </button>
            <button
              type="submit"
              className={`${styles.btn} ${styles.btnPrimary}`}
              disabled={submitting}
            >
              {submitting ? '提交中…' : '确认结算'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
