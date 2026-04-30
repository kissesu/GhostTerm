/**
 * @file QuoteChangeDialog.tsx
 * @description 费用变更提交对话框 —— Phase 8 Worker E。
 *
 *              业务流程：
 *              1. 用户在项目详情页点击"追加费用 / 修改报价 / 售后追加"按钮
 *              2. 本对话框打开，根据 isAfterSales prop 决定是否锁定为 after_sales 模式
 *              3. 用户填写：类型选择（非售后模式）、delta 或 newQuote、reason
 *              4. 提交前 client-side 校验（reason 必填 / Money 格式 2 位小数）
 *              5. 调 createQuoteChange → 成功后 quoteChangesStore.appendLocal
 *              6. onSuccess 回调（让上层 invalidate 项目详情，因为 current_quote 变了）
 *              7. 关闭对话框
 *
 *              UI 决策（与 habitat-grid-progress 设计稿对齐）：
 *              - 用 var(--panel) 浮起面板色 + var(--shadow) 阴影
 *              - 错误信息红色（var(--red) + 半透明背景）
 *              - 自带 backdrop（rgba 黑色遮罩 + blur），与 PaymentDialog 同源
 *
 *              不在本组件做的事：
 *              - 不显示历史变更列表（QuoteChangesList 在 Phase 8 plan 内是独立组件，本 worker
 *                ownership 仅 QuoteChangeDialog；列表组件由后续 worker 接手）
 *              - 不做"撤销/删除"操作（DB 没有 delete API，UI 永远只读历史）
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { useState } from 'react';

import { createQuoteChange, isValidMoneyString, type QuoteChangeType } from '../api/quotes';
import { useQuoteChangesStore } from '../stores/quoteChangesStore';
import styles from '../progress.module.css';

interface QuoteChangeDialogProps {
  /** 关联项目 id */
  projectId: number;
  /** 关闭对话框（取消 / 提交成功） */
  onClose: () => void;
  /**
   * 售后模式：锁定 changeType=after_sales，不展示类型选择器。
   * 由项目状态 = 'after_sales' 时的"追加费用"按钮点开使用。
   */
  isAfterSales?: boolean;
  /** 提交成功后的副作用钩子（让上层刷新项目详情中的 current_quote） */
  onSuccess?: () => void;
}

/**
 * 类型选择项（非售后模式）。
 *
 * 业务说明（spec §7.2）：
 *   - append：客户加新功能 → current_quote += delta
 *   - modify：商务让利或调整 → current_quote = newQuote
 *   - 售后追加（after_sales）独立入口；本组件 isAfterSales=true 时锁定该模式
 */
const TYPE_OPTIONS: ReadonlyArray<{ value: Exclude<QuoteChangeType, 'after_sales'>; label: string }> = [
  { value: 'append', label: '追加（加新功能）' },
  { value: 'modify', label: '修改报价（整体调整）' },
];

export function QuoteChangeDialog({
  projectId,
  onClose,
  isAfterSales = false,
  onSuccess,
}: QuoteChangeDialogProps) {
  const initialType: QuoteChangeType = isAfterSales ? 'after_sales' : 'append';
  const [changeType, setChangeType] = useState<QuoteChangeType>(initialType);
  const [delta, setDelta] = useState<string>('');
  const [newQuote, setNewQuote] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const appendLocal = useQuoteChangesStore((s) => s.appendLocal);

  // ============================================
  // 提交前校验：返回 null = 通过，返回 string = 失败原因
  // ============================================
  function validateForm(): string | null {
    if (reason.trim() === '') {
      return 'reason 必填';
    }
    if (changeType === 'modify') {
      if (newQuote === '' || !isValidMoneyString(newQuote)) {
        return 'newQuote 金额格式无效（最多 2 位小数）';
      }
    } else {
      // append / after_sales 需要 delta
      if (delta === '' || !isValidMoneyString(delta)) {
        return 'delta 金额格式无效（最多 2 位小数）';
      }
    }
    return null;
  }

  // ============================================
  // 提交：disable 按钮、调 API、错误暴露给 UI
  // ============================================
  async function handleSubmit() {
    setError(null);
    const validationError = validateForm();
    if (validationError !== null) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    try {
      const log = await createQuoteChange(projectId, {
        changeType,
        delta: changeType === 'modify' ? undefined : delta,
        newQuote: changeType === 'modify' ? newQuote : undefined,
        reason,
      });
      appendLocal(projectId, log);
      onSuccess?.();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  // 业务背景：QuoteChangeDialog 由 quote tab 直接渲染（没有 caller 提供的 backdrop），
  // 因此在此自带 backdrop + 居中布局，与 PaymentDialog 统一。
  return (
    <div
      data-testid="quote-change-backdrop"
      className={styles.modalBackdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) {
          onClose();
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(5, 5, 4, 0.55)',
        backdropFilter: 'blur(4px)',
        padding: 24,
      }}
    >
      <div
        data-testid="quote-change-dialog"
        role="dialog"
        aria-label={isAfterSales ? '售后追加费用' : '费用变更'}
        style={{
          background: 'var(--panel)',
          color: 'var(--text)',
          padding: '20px 22px',
          borderRadius: 9,
          border: '1px solid var(--line-strong)',
          boxShadow: 'var(--shadow)',
          minWidth: 420,
          maxWidth: 520,
          width: '100%',
          fontFamily: 'inherit',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: 'var(--text)', letterSpacing: 0.2 }}>
          {isAfterSales ? '售后追加费用' : '费用变更'}
        </h3>

        {/* 类型选择（仅非售后模式展示） */}
        {!isAfterSales && (
          <label style={qcLabelStyle}>
            <span style={qcLabelTextStyle}>类型</span>
            <select
              data-testid="qc-type"
              value={changeType}
              onChange={(e) => setChangeType(e.target.value as QuoteChangeType)}
              style={qcInputStyle}
            >
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {/* 金额输入：modify=新报价；其它=变化金额 */}
        {changeType === 'modify' ? (
          <label style={qcLabelStyle}>
            <span style={qcLabelTextStyle}>新报价（元）</span>
            <input
              data-testid="qc-new-quote"
              type="text"
              inputMode="decimal"
              value={newQuote}
              onChange={(e) => setNewQuote(e.target.value)}
              placeholder="例如 5000.00"
              style={qcInputStyle}
            />
          </label>
        ) : (
          <label style={qcLabelStyle}>
            <span style={qcLabelTextStyle}>变化金额（元）</span>
            <input
              data-testid="qc-delta"
              type="text"
              inputMode="decimal"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              placeholder="例如 1500.00"
              style={qcInputStyle}
            />
          </label>
        )}

        {/* 原因（必填） */}
        <label style={qcLabelStyle}>
          <span style={qcLabelTextStyle}>
            原因 <span style={{ color: 'var(--red)', marginLeft: 2 }}>*</span>
          </span>
          <textarea
            data-testid="qc-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="例如：客户加新功能，需追加费用"
            style={{ ...qcInputStyle, resize: 'vertical', minHeight: 78, paddingTop: 10, lineHeight: 1.6 }}
          />
        </label>

        {/* 错误提示 */}
        {error !== null && (
          <div
            data-testid="qc-error"
            role="alert"
            style={{
              padding: '8px 12px',
              border: '1px solid rgba(239, 104, 98, 0.4)',
              borderRadius: 6,
              background: 'rgba(239, 104, 98, 0.1)',
              color: '#ffd8d4',
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}

        {/* 操作按钮 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button
            data-testid="qc-cancel"
            onClick={onClose}
            disabled={submitting}
            type="button"
            style={qcSecondaryBtnStyle}
          >
            取消
          </button>
          <button
            data-testid="qc-submit"
            onClick={handleSubmit}
            disabled={submitting}
            type="button"
            style={qcPrimaryBtnStyle}
          >
            {submitting ? '提交中…' : '提交'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// 内联样式（与 habitat-grid-progress 设计稿对齐）
// ============================================

const qcLabelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const qcLabelTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#d8d1bf',
  fontWeight: 600,
};

const qcInputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 36,
  padding: '8px 11px',
  borderRadius: 6,
  border: '1px solid var(--line)',
  background: '#11110f',
  color: 'var(--text)',
  fontSize: 12,
  fontFamily: 'inherit',
  outline: 'none',
};

const qcPrimaryBtnStyle: React.CSSProperties = {
  height: 32,
  padding: '0 14px',
  borderRadius: 6,
  border: '1px solid transparent',
  background: 'var(--accent)',
  color: 'var(--accent-ink)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 800,
  fontFamily: 'inherit',
};

const qcSecondaryBtnStyle: React.CSSProperties = {
  height: 32,
  padding: '0 14px',
  borderRadius: 6,
  border: '1px solid var(--line)',
  background: '#11110f',
  color: 'var(--muted)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 800,
  fontFamily: 'inherit',
};
