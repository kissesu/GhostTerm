/**
 * @file PaymentDialog.test.tsx
 * @description PaymentDialog 单测：
 *              a11y / ESC 关闭 / 空金额提交 → 错误提示 /
 *              填齐后 addPayment 调对 + onSuccess + onClose 被调用
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { PaymentDialog } from '../PaymentDialog';

const mockAddPayment = vi.fn();

vi.mock('../../stores/paymentsStore', () => ({
  usePaymentsStore: (selector: (s: object) => unknown) =>
    selector({ addPayment: mockAddPayment }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PaymentDialog', () => {
  const onClose = vi.fn();
  const onSuccess = vi.fn();

  beforeEach(() => {
    mockAddPayment.mockResolvedValue({ id: 1 });
  });

  it('role=dialog + aria-modal=true + aria-labelledby 指向标题', () => {
    render(<PaymentDialog projectId={1} onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'payment-dialog-title');
    expect(screen.getByText('新增结算')).toBeInTheDocument();
  });

  it('空金额提交 → 显示"请输入有效金额"', async () => {
    render(<PaymentDialog projectId={1} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: '确认结算' }));
    expect(screen.getByText('请输入有效金额')).toBeInTheDocument();
    expect(mockAddPayment).not.toHaveBeenCalled();
  });

  it('填写金额后提交 → addPayment 被调用含 direction=customer_in', async () => {
    render(<PaymentDialog projectId={5} onClose={onClose} onSuccess={onSuccess} />);
    const amtInput = screen.getByLabelText(/结算金额/);
    await userEvent.type(amtInput, '1500');
    await userEvent.click(screen.getByRole('button', { name: '确认结算' }));

    expect(mockAddPayment).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        direction: 'customer_in',
        // 输入 "1500" → toFixed(2) 归一为 "1500.00" 让 OAS Money pattern 通过
        amount: '1500.00',
      }),
    );
  });

  it('提交成功后调用 onSuccess + onClose', async () => {
    render(<PaymentDialog projectId={1} onClose={onClose} onSuccess={onSuccess} />);
    const amtInput = screen.getByLabelText(/结算金额/);
    await userEvent.type(amtInput, '500');
    await userEvent.click(screen.getByRole('button', { name: '确认结算' }));
    expect(onSuccess).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('提交失败时显示 error，不调用 onClose', async () => {
    mockAddPayment.mockRejectedValue(new Error('余额不足'));
    render(<PaymentDialog projectId={1} onClose={onClose} />);
    const amtInput = screen.getByLabelText(/结算金额/);
    await userEvent.type(amtInput, '999');
    await userEvent.click(screen.getByRole('button', { name: '确认结算' }));
    expect(await screen.findByText('余额不足')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('点击取消按钮调用 onClose', async () => {
    render(<PaymentDialog projectId={1} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('ESC 键调用 onClose', async () => {
    render(<PaymentDialog projectId={1} onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
