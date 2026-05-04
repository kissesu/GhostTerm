/**
 * @file QuoteChangeDialog.tsx
 * @description 调整报价弹窗 - 字段：新报价金额 + 原因
 *              提交调 quoteChangesStore.addQuoteChange，changeType 固定 modify
 *
 *              changeType 固定 modify：UI 入口语义是"直接设新报价"（非累加 delta），
 *              与 dealing/quoting 阶段报价调整对齐。
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { useState, useEffect, type ReactElement, type FormEvent } from 'react';
import styles from '../progress.module.css';
import { useQuoteChangesStore } from '../stores/quoteChangesStore';

const TITLE_ID = 'quote-change-dialog-title';

interface QuoteChangeDialogProps {
  projectId: number;
  onClose: () => void;
  onSuccess?: () => void;
}

export function QuoteChangeDialog({
  projectId,
  onClose,
  onSuccess,
}: QuoteChangeDialogProps): ReactElement {
  const [newAmount, setNewAmount] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addQuoteChange = useQuoteChangesStore((s) => s.addQuoteChange);

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
    const trimmedAmount = newAmount.trim();
    const trimmedReason = reason.trim();
    // 金额数值校验：必须是有限非负数；接受 "5000" / "5000.5" / "5000.50"
    const parsedAmount = Number(trimmedAmount);
    if (!trimmedAmount || !Number.isFinite(parsedAmount) || parsedAmount < 0) {
      setError('请输入有效金额');
      return;
    }
    if (!trimmedReason) {
      setError('请填写调整原因');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      // OAS Money pattern 强制 2 位小数（^-?\d+\.\d{2}$）；
      // 输入框 step=0.01 但浏览器允许整数（"5000"），后端 ogen 会在解码阶段
      // 拒掉无小数的字符串并 500，所以前端必须 toFixed(2) 归一到 "5000.00"。
      // 与 NewProjectDialog originalQuote / PaymentDialog amount 保持同一约定。
      const normalizedAmount = parsedAmount.toFixed(2);
      // changeType=modify 需传 newQuote；quotes.ts createQuoteChange 会做客户端校验
      await addQuoteChange(projectId, {
        changeType: 'modify',
        newQuote: normalizedAmount,
        reason: trimmedReason,
      });
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
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
        data-testid="quote-change-dialog"
      >
        <div className={styles.modalHead}>
          <h3 id={TITLE_ID}>调整报价</h3>
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
              <label htmlFor="qc-amount">新报价金额（¥） *</label>
              <input
                id="qc-amount"
                type="number"
                min="0"
                step="0.01"
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
                autoFocus
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="qc-reason">调整原因 *</label>
              <textarea
                id="qc-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
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
              {submitting ? '提交中…' : '确认调整'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
