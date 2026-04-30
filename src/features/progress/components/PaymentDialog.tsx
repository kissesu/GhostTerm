/**
 * @file PaymentDialog.tsx
 * @description 录入收款 / 开发结算的对话框（Phase 9 Worker F）。
 *
 *              业务定位：
 *                - 项目详情页 / 财务面板 中点击"录入"打开
 *                - direction = customer_in：普通收款（仅 amount + remark）
 *                - direction = dev_settlement：结算给开发（必须 relatedUserId + screenshotId）
 *
 *              Money 处理：
 *                - 输入框用 type="number" + step="0.01" + min="0.01"（HTML5 校验前置）
 *                - 提交时 toFixed(2) 转 string 给后端，避免浮点精度
 *                - 后端 db.Money 拒绝 3+ 位小数，前端先 truncate
 *
 *              校验链：
 *                1. HTML5 required + min/max
 *                2. 提交前自检（amount > 0 / dev_settlement 必填字段）
 *                3. 后端 service ErrPaymentXxx → 显示在 error 区
 *
 *              不做的事：
 *                - 不集成"上传截图"组件：截图上传由 FileService（Phase 6）提供，
 *                  本对话框接受外部传入 screenshotId（已上传的 file_id）
 *                - 不做 priceFormatter：v1 直接 ¥ + toFixed(2) 原始展示
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { useState, type FormEvent } from 'react';

import { usePaymentsStore } from '../stores/paymentsStore';
import { useEarningsStore } from '../stores/earningsStore';
import type { PaymentDirection } from '../api/payments';

interface PaymentDialogProps {
  /** 项目 ID（必填，决定写入到哪个项目下） */
  projectId: number;
  /** 关闭回调 */
  onClose: () => void;
  /** 提交成功回调（可选，外部用于关闭 + toast） */
  onSuccess?: () => void;
  /**
   * 已上传的截图文件 ID（仅 dev_settlement 必需）。
   *
   * 业务背景：截图上传组件由 FileService phase 提供；本对话框只接收上传后的 fileId，
   * 避免与文件上传 UI 耦合。如果需要在对话框内上传截图，由调用方组合 <FileUploader> + 本组件
   */
  screenshotId?: number | null;
}

/**
 * 录入 payment 的模态对话框。
 *
 * 语义：本组件不渲染任何 portal/overlay；调用方决定布局（drawer / modal / inline）。
 * 这样保持组件纯净，便于在不同上下文下复用。
 */
export default function PaymentDialog({
  projectId,
  onClose,
  onSuccess,
  screenshotId: initialScreenshotId,
}: PaymentDialogProps) {
  // 表单状态
  const [direction, setDirection] = useState<PaymentDirection>('customer_in');
  const [amount, setAmount] = useState<string>('');
  const [remark, setRemark] = useState<string>('');
  const [relatedUserId, setRelatedUserId] = useState<string>('');
  const [screenshotIdInput, setScreenshotIdInput] = useState<string>(
    initialScreenshotId != null ? String(initialScreenshotId) : '',
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = usePaymentsStore((s) => s.create);
  const refetchEarnings = useEarningsStore((s) => s.refetch);

  /**
   * 提交逻辑：
   * 1. 应用层 pre-check（避免无意义的 422 round-trip）
   * 2. amount toFixed(2) 转 string
   * 3. 调 store.create
   * 4. dev_settlement 成功后顺带 refetch earnings（dashboard 即时刷新）
   */
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    // 第一步：应用层校验
    const amountNum = parseFloat(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError('金额必须 > 0');
      return;
    }
    if (!remark.trim()) {
      setError('备注不能为空');
      return;
    }

    let parsedRelatedUserId: number | null = null;
    let parsedScreenshotId: number | null = null;
    if (direction === 'dev_settlement') {
      const ru = parseInt(relatedUserId, 10);
      const sid = parseInt(screenshotIdInput, 10);
      if (!Number.isInteger(ru) || ru <= 0) {
        setError('结算必须填开发用户 ID');
        return;
      }
      if (!Number.isInteger(sid) || sid <= 0) {
        setError('结算必须先上传截图（screenshotId）');
        return;
      }
      parsedRelatedUserId = ru;
      parsedScreenshotId = sid;
    }

    // 第二步：构造 payload，amount toFixed(2) 防 3+ 位小数被后端拒
    const payload = {
      direction,
      amount: amountNum.toFixed(2),
      paidAt: new Date().toISOString(),
      relatedUserId: parsedRelatedUserId,
      screenshotId: parsedScreenshotId,
      remark: remark.trim(),
    };

    // 第三步：提交
    setSubmitting(true);
    try {
      await create(projectId, payload);
      // dev_settlement 成功后：dashboard 即时刷新（refetch earnings）
      if (direction === 'dev_settlement') {
        refetchEarnings().catch(() => {
          // refetch 失败不阻断主流程，dashboard 下次自动 retry
        });
      }
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 业务背景：与 QuoteChangeDialog 一致，自带 backdrop + 居中浮起
  return (
    <div
      data-testid="payment-backdrop"
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
      <form
        data-testid="payment-dialog"
        onSubmit={handleSubmit}
        style={{
          width: 440,
          maxWidth: '100%',
          padding: '20px 22px',
          background: 'var(--panel)',
          border: '1px solid var(--line-strong)',
          borderRadius: 9,
          boxShadow: 'var(--shadow)',
          color: 'var(--text)',
          fontFamily: 'inherit',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, letterSpacing: 0.2 }}>录入财务流水</h3>

        <label style={labelStyle}>
          <span style={labelTextStyle}>类型</span>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as PaymentDirection)}
            data-testid="payment-direction"
            style={inputStyle}
          >
            <option value="customer_in">客户付款入账</option>
            <option value="dev_settlement">结算给开发</option>
          </select>
        </label>

        <label style={labelStyle}>
          <span style={labelTextStyle}>金额（¥）</span>
          <input
            type="number"
            step="0.01"
            min="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            data-testid="payment-amount"
            style={inputStyle}
            placeholder="0.00"
          />
        </label>

        {direction === 'dev_settlement' && (
          <>
            <label style={labelStyle}>
              <span style={labelTextStyle}>开发用户 ID</span>
              <input
                type="number"
                min="1"
                value={relatedUserId}
                onChange={(e) => setRelatedUserId(e.target.value)}
                data-testid="payment-related-user-id"
                style={inputStyle}
                placeholder="user_id"
              />
            </label>

            <label style={labelStyle}>
              <span style={labelTextStyle}>结算截图文件 ID</span>
              <input
                type="number"
                min="1"
                value={screenshotIdInput}
                onChange={(e) => setScreenshotIdInput(e.target.value)}
                data-testid="payment-screenshot-id"
                style={inputStyle}
                placeholder="先上传截图获取 file_id"
              />
            </label>
          </>
        )}

        <label style={labelStyle}>
          <span style={labelTextStyle}>备注</span>
          <textarea
            required
            rows={3}
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            data-testid="payment-remark"
            style={{ ...inputStyle, resize: 'vertical', minHeight: 78, paddingTop: 10, lineHeight: 1.6 }}
          />
        </label>

        {error && (
          <div
            data-testid="payment-error"
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

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            data-testid="payment-cancel"
            style={secondaryBtnStyle}
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting}
            data-testid="payment-submit"
            style={primaryBtnStyle}
          >
            {submitting ? '提交中…' : '录入'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ============================================
// 内联样式（habitat 设计 tokens）
// ============================================

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 12,
};

const labelTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#d8d1bf',
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
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

const primaryBtnStyle: React.CSSProperties = {
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

const secondaryBtnStyle: React.CSSProperties = {
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
