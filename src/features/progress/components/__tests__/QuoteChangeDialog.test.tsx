/**
 * @file QuoteChangeDialog.test.tsx
 * @description QuoteChangeDialog 单测：
 *              a11y / ESC 关闭 / 空金额 → 错误提示 / 空原因 → 错误提示 /
 *              填齐后 addQuoteChange 调对 + onSuccess + onClose 被调用
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { QuoteChangeDialog } from '../QuoteChangeDialog';

const mockAddQuoteChange = vi.fn();

vi.mock('../../stores/quoteChangesStore', () => ({
  useQuoteChangesStore: (selector: (s: object) => unknown) =>
    selector({ addQuoteChange: mockAddQuoteChange }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('QuoteChangeDialog', () => {
  const onClose = vi.fn();
  const onSuccess = vi.fn();

  beforeEach(() => {
    mockAddQuoteChange.mockResolvedValue({ id: 1 });
  });

  it('role=dialog + aria-modal=true + aria-labelledby 指向标题', () => {
    render(<QuoteChangeDialog projectId={1} onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'quote-change-dialog-title');
    expect(screen.getByText('调整报价')).toBeInTheDocument();
  });

  it('空金额提交 → 显示"请输入有效金额"', async () => {
    render(<QuoteChangeDialog projectId={1} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: '确认调整' }));
    expect(screen.getByText('请输入有效金额')).toBeInTheDocument();
    expect(mockAddQuoteChange).not.toHaveBeenCalled();
  });

  it('填写金额但空原因 → 显示"请填写调整原因"', async () => {
    render(<QuoteChangeDialog projectId={1} onClose={onClose} />);
    const amtInput = screen.getByLabelText(/新报价金额/);
    await userEvent.type(amtInput, '9000');
    await userEvent.click(screen.getByRole('button', { name: '确认调整' }));
    expect(screen.getByText('请填写调整原因')).toBeInTheDocument();
    expect(mockAddQuoteChange).not.toHaveBeenCalled();
  });

  it('填齐金额 + 原因 → addQuoteChange 调对，changeType=modify', async () => {
    render(<QuoteChangeDialog projectId={3} onClose={onClose} onSuccess={onSuccess} />);
    const amtInput = screen.getByLabelText(/新报价金额/);
    const reasonInput = screen.getByLabelText(/调整原因/);
    await userEvent.type(amtInput, '9000');
    await userEvent.type(reasonInput, '需求增加');
    await userEvent.click(screen.getByRole('button', { name: '确认调整' }));

    expect(mockAddQuoteChange).toHaveBeenCalledWith(
      3,
      expect.objectContaining({
        changeType: 'modify',
        newQuote: '9000',
        reason: '需求增加',
      }),
    );
  });

  it('提交成功后调用 onSuccess + onClose', async () => {
    render(<QuoteChangeDialog projectId={1} onClose={onClose} onSuccess={onSuccess} />);
    const amtInput = screen.getByLabelText(/新报价金额/);
    const reasonInput = screen.getByLabelText(/调整原因/);
    await userEvent.type(amtInput, '8000');
    await userEvent.type(reasonInput, '客户确认');
    await userEvent.click(screen.getByRole('button', { name: '确认调整' }));
    expect(onSuccess).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('提交失败时显示 error，不调用 onClose', async () => {
    mockAddQuoteChange.mockRejectedValue(new Error('服务器拒绝'));
    render(<QuoteChangeDialog projectId={1} onClose={onClose} />);
    const amtInput = screen.getByLabelText(/新报价金额/);
    const reasonInput = screen.getByLabelText(/调整原因/);
    await userEvent.type(amtInput, '5000');
    await userEvent.type(reasonInput, '降价');
    await userEvent.click(screen.getByRole('button', { name: '确认调整' }));
    expect(await screen.findByText('服务器拒绝')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('点击取消按钮调用 onClose', async () => {
    render(<QuoteChangeDialog projectId={1} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('ESC 键调用 onClose', async () => {
    render(<QuoteChangeDialog projectId={1} onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
