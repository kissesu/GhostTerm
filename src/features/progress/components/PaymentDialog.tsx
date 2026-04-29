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

  return (
    <form
      data-testid="payment-dialog"
      onSubmit={handleSubmit}
      style={{
        width: 360,
        padding: 20,
        background: 'var(--c-panel)',
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>录入财务流水</h3>

      <label style={labelStyle}>
        <span>类型</span>
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
        <span>金额（¥）</span>
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
            <span>开发用户 ID</span>
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
            <span>结算截图文件 ID</span>
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
        <span>备注</span>
        <textarea
          required
          rows={3}
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          data-testid="payment-remark"
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </label>

      {error && (
        <div data-testid="payment-error" style={{ fontSize: 12, color: 'var(--c-danger, #d8453b)' }}>
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
  );
}

// ============================================
// 内联样式（与 LoginPage 风格一致）
// ============================================

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
};

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderRadius: 4,
  border: '1px solid var(--c-border)',
  background: 'var(--c-bg)',
  color: 'var(--c-fg)',
  fontSize: 13,
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  border: 'none',
  background: 'var(--c-accent)',
  color: 'var(--c-on-accent, #fff)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  border: '1px solid var(--c-border)',
  background: 'transparent',
  color: 'var(--c-fg)',
  cursor: 'pointer',
  fontSize: 13,
};
