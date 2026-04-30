/**
 * @file QuoteChangeDialog.test.tsx
 * @description Phase 8 Worker E QuoteChangeDialog 组件测试。
 *
 *              覆盖：
 *              - 默认渲染：append 类型 + delta 输入框
 *              - isAfterSales=true：锁定 after_sales，不渲染类型选择器
 *              - 切换类型 modify：显示 newQuote 输入框
 *              - reason 为空 → 提交报错（不调 API）
 *              - delta 3 位小数 → 客户端校验拒绝（不调 API）
 *              - 合法 append 提交 → 调 createQuoteChange + appendLocal + onClose + onSuccess
 *              - 合法 modify 提交 → 携带 newQuote 而非 delta
 *              - API 错误 → 显示在错误区
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ============================================
// mock api/quotes：拦截 createQuoteChange / listQuoteChanges
// 注：vi.mock 工厂会被 vitest hoist 到 import 之前
// ============================================
vi.mock('../../api/quotes', async () => {
  // 保留 isValidMoneyString 与 MONEY_PATTERN 真实实现，便于校验逻辑测试
  const actual = await vi.importActual<typeof import('../../api/quotes')>('../../api/quotes');
  return {
    ...actual,
    createQuoteChange: vi.fn(),
    listQuoteChanges: vi.fn(),
  };
});

import { createQuoteChange, type QuoteChange } from '../../api/quotes';
import { useQuoteChangesStore } from '../../stores/quoteChangesStore';
import { QuoteChangeDialog } from '../QuoteChangeDialog';

const mockedCreate = vi.mocked(createQuoteChange);

const sampleLog = (overrides: Partial<QuoteChange> = {}): QuoteChange => ({
  id: 1,
  projectId: 100,
  changeType: 'append',
  delta: '1500.00',
  oldQuote: '5000.00',
  newQuote: '6500.00',
  reason: '客户加新功能',
  phase: 'developing',
  changedBy: 7,
  changedAt: '2026-04-29T10:00:00Z',
  ...overrides,
});

beforeEach(() => {
  // 每个用例重置 mock + store
  mockedCreate.mockReset();
  useQuoteChangesStore.getState().clearAll();
});

// ============================================================
// 渲染
// ============================================================

describe('QuoteChangeDialog - 默认渲染', () => {
  it('非售后模式默认渲染 append 类型 + delta 输入框', () => {
    render(<QuoteChangeDialog projectId={100} onClose={() => {}} />);

    expect(screen.getByTestId('quote-change-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('qc-type')).toBeInTheDocument();
    expect(screen.getByTestId('qc-delta')).toBeInTheDocument();
    expect(screen.queryByTestId('qc-new-quote')).toBeNull();
    expect(screen.getByTestId('qc-reason')).toBeInTheDocument();
    expect(screen.getByTestId('qc-submit')).toBeInTheDocument();
  });

  it('isAfterSales=true 锁定 after_sales 模式：不渲染类型选择器，渲染 delta', () => {
    render(<QuoteChangeDialog projectId={100} onClose={() => {}} isAfterSales />);

    expect(screen.queryByTestId('qc-type')).toBeNull();
    expect(screen.getByTestId('qc-delta')).toBeInTheDocument();
    // 标题切到"售后追加费用"
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', '售后追加费用');
  });

  it('切换类型为 modify 后显示 newQuote 输入框', async () => {
    const user = userEvent.setup();
    render(<QuoteChangeDialog projectId={100} onClose={() => {}} />);

    await user.selectOptions(screen.getByTestId('qc-type'), 'modify');
    expect(screen.queryByTestId('qc-delta')).toBeNull();
    expect(screen.getByTestId('qc-new-quote')).toBeInTheDocument();
  });
});

// ============================================================
// 客户端校验
// ============================================================

describe('QuoteChangeDialog - 提交前校验', () => {
  it('reason 为空时点击提交：不调 API + 显示错误', async () => {
    const user = userEvent.setup();
    render(<QuoteChangeDialog projectId={100} onClose={() => {}} />);

    await user.type(screen.getByTestId('qc-delta'), '1500');
    await user.click(screen.getByTestId('qc-submit'));

    expect(mockedCreate).not.toHaveBeenCalled();
    expect(screen.getByTestId('qc-error')).toHaveTextContent(/reason/);
  });

  it('reason 仅空白也算空（trim 后）', async () => {
    const user = userEvent.setup();
    render(<QuoteChangeDialog projectId={100} onClose={() => {}} />);

    await user.type(screen.getByTestId('qc-delta'), '1500');
    await user.type(screen.getByTestId('qc-reason'), '   ');
    await user.click(screen.getByTestId('qc-submit'));

    expect(mockedCreate).not.toHaveBeenCalled();
    expect(screen.getByTestId('qc-error')).toBeInTheDocument();
  });

  it('delta 3 位小数被客户端拒绝（不调 API）', async () => {
    const user = userEvent.setup();
    render(<QuoteChangeDialog projectId={100} onClose={() => {}} />);

    await user.type(screen.getByTestId('qc-delta'), '1.234'); // 3 位小数 → 非法
    await user.type(screen.getByTestId('qc-reason'), '原因');
    await user.click(screen.getByTestId('qc-submit'));

    expect(mockedCreate).not.toHaveBeenCalled();
    expect(screen.getByTestId('qc-error')).toHaveTextContent(/2 位小数/);
  });

  it('delta 为非数字（abc）也被拒绝', async () => {
    const user = userEvent.setup();
    render(<QuoteChangeDialog projectId={100} onClose={() => {}} />);

    await user.type(screen.getByTestId('qc-delta'), 'abc');
    await user.type(screen.getByTestId('qc-reason'), '原因');
    await user.click(screen.getByTestId('qc-submit'));

    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('modify 模式下 newQuote 3 位小数也被拒绝', async () => {
    const user = userEvent.setup();
    render(<QuoteChangeDialog projectId={100} onClose={() => {}} />);

    await user.selectOptions(screen.getByTestId('qc-type'), 'modify');
    await user.type(screen.getByTestId('qc-new-quote'), '4500.123');
    await user.type(screen.getByTestId('qc-reason'), '让利');
    await user.click(screen.getByTestId('qc-submit'));

    expect(mockedCreate).not.toHaveBeenCalled();
  });
});

// ============================================================
// 提交成功
// ============================================================

describe('QuoteChangeDialog - 提交成功', () => {
  it('合法 append 提交：调 createQuoteChange + appendLocal + onSuccess + onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    const created = sampleLog({ id: 99, delta: '1500.00', reason: '加功能' });
    mockedCreate.mockResolvedValueOnce(created);

    render(
      <QuoteChangeDialog
        projectId={100}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    await user.type(screen.getByTestId('qc-delta'), '1500');
    await user.type(screen.getByTestId('qc-reason'), '加功能');
    await user.click(screen.getByTestId('qc-submit'));

    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledTimes(1);
    });
    expect(mockedCreate).toHaveBeenCalledWith(100, {
      changeType: 'append',
      delta: '1500',
      newQuote: undefined,
      reason: '加功能',
    });
    // store 被追加
    expect(useQuoteChangesStore.getState().byProject.get(100)).toEqual([created]);
    // 回调被触发
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('合法 modify 提交：携带 newQuote，不带 delta', async () => {
    const user = userEvent.setup();
    const created = sampleLog({ changeType: 'modify', delta: '-500.00', newQuote: '4500.00' });
    mockedCreate.mockResolvedValueOnce(created);

    render(<QuoteChangeDialog projectId={100} onClose={() => {}} />);

    await user.selectOptions(screen.getByTestId('qc-type'), 'modify');
    await user.type(screen.getByTestId('qc-new-quote'), '4500');
    await user.type(screen.getByTestId('qc-reason'), '让利');
    await user.click(screen.getByTestId('qc-submit'));

    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledTimes(1);
    });
    expect(mockedCreate).toHaveBeenCalledWith(100, {
      changeType: 'modify',
      delta: undefined,
      newQuote: '4500',
      reason: '让利',
    });
  });

  it('isAfterSales=true 提交：changeType=after_sales', async () => {
    const user = userEvent.setup();
    const created = sampleLog({ changeType: 'after_sales' });
    mockedCreate.mockResolvedValueOnce(created);

    render(<QuoteChangeDialog projectId={100} onClose={() => {}} isAfterSales />);

    await user.type(screen.getByTestId('qc-delta'), '800');
    await user.type(screen.getByTestId('qc-reason'), '售后追加');
    await user.click(screen.getByTestId('qc-submit'));

    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledTimes(1);
    });
    expect(mockedCreate).toHaveBeenCalledWith(100, {
      changeType: 'after_sales',
      delta: '800',
      newQuote: undefined,
      reason: '售后追加',
    });
  });
});

// ============================================================
// 提交失败
// ============================================================

describe('QuoteChangeDialog - 提交失败', () => {
  it('API 错误显示在错误区，不调 onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mockedCreate.mockRejectedValueOnce(new Error('后端 422：项目不存在'));

    render(<QuoteChangeDialog projectId={100} onClose={onClose} />);

    await user.type(screen.getByTestId('qc-delta'), '1500');
    await user.type(screen.getByTestId('qc-reason'), '加功能');
    await user.click(screen.getByTestId('qc-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('qc-error')).toHaveTextContent('后端 422：项目不存在');
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('提交失败后按钮重新可用（submitting 复位）', async () => {
    const user = userEvent.setup();
    mockedCreate.mockRejectedValueOnce(new Error('网络错误'));

    render(<QuoteChangeDialog projectId={100} onClose={() => {}} />);

    await user.type(screen.getByTestId('qc-delta'), '1500');
    await user.type(screen.getByTestId('qc-reason'), '加功能');
    const submit = screen.getByTestId('qc-submit') as HTMLButtonElement;
    await user.click(submit);

    await waitFor(() => {
      expect(submit.disabled).toBe(false);
    });
  });
});

// ============================================================
// 取消按钮
// ============================================================

describe('QuoteChangeDialog - 取消', () => {
  it('点击取消调 onClose，不调 API', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<QuoteChangeDialog projectId={100} onClose={onClose} />);

    await user.click(screen.getByTestId('qc-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});
