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
import { useState, useEffect, type ReactElement, type FormEvent } from 'react';
import styles from '../progress.module.css';
import { usePaymentsStore } from '../stores/paymentsStore';

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
    if (!trimmed || Number.isNaN(Number(trimmed)) || Number(trimmed) <= 0) {
      setError('请输入有效金额');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // ============================================
      // 构造符合 PaymentCreatePayload 类型的请求体：
      // - direction: 固定 customer_in（本弹窗仅用于客户收款）
      // - amount: 金额字符串（Money 类型，后端期望 "123.45"）
      // - paidAt: 当前 ISO datetime
      // - remark: "方式：备注" 拼接，便于后续检索
      // ============================================
      const remark = note.trim() ? `${method}：${note.trim()}` : method;
      await addPayment(projectId, {
        direction: 'customer_in',
        amount: trimmed,
        paidAt: new Date().toISOString(),
        remark,
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
        data-testid="payment-dialog"
      >
        <div className={styles.modalHead}>
          <h3 id={TITLE_ID}>新增收款</h3>
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
              <label htmlFor="payment-amount">收款金额（¥） *</label>
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
              {submitting ? '提交中…' : '确认收款'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
