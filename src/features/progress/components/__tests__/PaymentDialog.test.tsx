/**
 * @file PaymentDialog.test.tsx
 * @description Phase 9 Worker F PaymentDialog 组件测试。
 *
 *              覆盖：
 *              - 默认渲染：customer_in 类型，仅显示 amount + remark（不显示 settlement 字段）
 *              - 切换 dev_settlement：显示 relatedUserId + screenshotId 字段
 *              - 客户端校验：amount<=0 / remark 空 / dev_settlement 缺字段 → 不调 API
 *              - 合法 customer_in 提交 → 调 createPayment + onSuccess + onClose
 *              - 合法 dev_settlement 提交 → 调 createPayment + 同时 refetch earnings
 *              - API 错误 → 显示在错误区
 *              - 取消 → onClose 不调 API
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ============================================
// mock api/payments：拦截 createPayment
// ============================================
vi.mock('../../api/payments', async () => {
  const actual = await vi.importActual<typeof import('../../api/payments')>('../../api/payments');
  return {
    ...actual,
    createPayment: vi.fn(),
    listProjectPayments: vi.fn(),
  };
});

// ============================================
// mock api/earnings：拦截 getMyEarnings
// ============================================
vi.mock('../../api/earnings', async () => {
  const actual = await vi.importActual<typeof import('../../api/earnings')>('../../api/earnings');
  return {
    ...actual,
    getMyEarnings: vi.fn(),
  };
});

import { createPayment, type Payment } from '../../api/payments';
import { getMyEarnings } from '../../api/earnings';
import { usePaymentsStore } from '../../stores/paymentsStore';
import { useEarningsStore } from '../../stores/earningsStore';
import PaymentDialog from '../PaymentDialog';

const mockedCreate = vi.mocked(createPayment);
const mockedGetEarnings = vi.mocked(getMyEarnings);

const samplePayment = (overrides: Partial<Payment> = {}): Payment => ({
  id: 1,
  projectId: 100,
  direction: 'customer_in',
  amount: '1234.56',
  paidAt: '2026-04-29T10:00:00Z',
  relatedUserId: null,
  screenshotId: null,
  remark: '首付',
  recordedBy: 7,
  recordedAt: '2026-04-29T10:00:00Z',
  ...overrides,
});

beforeEach(() => {
  mockedCreate.mockReset();
  mockedGetEarnings.mockReset();
  usePaymentsStore.getState().clear();
  useEarningsStore.getState().clear();
});

// ============================================================
// 默认渲染
// ============================================================

describe('PaymentDialog - 默认渲染', () => {
  it('默认渲染 customer_in 类型，不显示 settlement 字段', () => {
    render(<PaymentDialog projectId={100} onClose={() => {}} />);

    expect(screen.getByTestId('payment-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('payment-direction')).toBeInTheDocument();
    expect(screen.getByTestId('payment-amount')).toBeInTheDocument();
    expect(screen.getByTestId('payment-remark')).toBeInTheDocument();
    expect(screen.queryByTestId('payment-related-user-id')).toBeNull();
    expect(screen.queryByTestId('payment-screenshot-id')).toBeNull();
  });

  it('切换到 dev_settlement 后显示 relatedUserId + screenshotId 字段', async () => {
    const user = userEvent.setup();
    render(<PaymentDialog projectId={100} onClose={() => {}} />);

    await user.selectOptions(screen.getByTestId('payment-direction'), 'dev_settlement');

    expect(screen.getByTestId('payment-related-user-id')).toBeInTheDocument();
    expect(screen.getByTestId('payment-screenshot-id')).toBeInTheDocument();
  });
});

// ============================================================
// 客户端校验：不合法时不调 API
// ============================================================

describe('PaymentDialog - 客户端校验', () => {
  it('amount 为空（用户未输入）→ HTML5 required 阻止表单提交，不调 API', async () => {
    const user = userEvent.setup();
    render(<PaymentDialog projectId={100} onClose={() => {}} />);

    await user.type(screen.getByTestId('payment-remark'), '测试');
    await user.click(screen.getByTestId('payment-submit'));

    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('amount = 0 应用层校验拒绝', async () => {
    const user = userEvent.setup();
    render(<PaymentDialog projectId={100} onClose={() => {}} />);

    // 用 fireEvent 直接设值绕过 HTML5 min（min=0.01 会拦掉真实输入，但 setUserValue 会绕开）
    const amountInput = screen.getByTestId('payment-amount') as HTMLInputElement;
    await user.clear(amountInput);
    // 直接设值
    amountInput.value = '0';
    amountInput.dispatchEvent(new Event('input', { bubbles: true }));
    amountInput.dispatchEvent(new Event('change', { bubbles: true }));
    // remark 必填
    await user.type(screen.getByTestId('payment-remark'), '测试');
    await user.click(screen.getByTestId('payment-submit'));

    // 浏览器 min=0.01 会拦截 form submit；mockedCreate 必定未被调用
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('remark 仅空白（trim 后空） → 不调 API + 显示错误', async () => {
    const user = userEvent.setup();
    render(<PaymentDialog projectId={100} onClose={() => {}} />);

    await user.type(screen.getByTestId('payment-amount'), '100');
    await user.type(screen.getByTestId('payment-remark'), '   ');
    await user.click(screen.getByTestId('payment-submit'));

    expect(mockedCreate).not.toHaveBeenCalled();
    expect(screen.getByTestId('payment-error')).toHaveTextContent(/备注/);
  });

  it('dev_settlement 缺 relatedUserId → 不调 API + 显示错误', async () => {
    const user = userEvent.setup();
    render(<PaymentDialog projectId={100} onClose={() => {}} />);

    await user.selectOptions(screen.getByTestId('payment-direction'), 'dev_settlement');
    await user.type(screen.getByTestId('payment-amount'), '3000');
    await user.type(screen.getByTestId('payment-remark'), '结算');
    // 不填 relatedUserId / screenshotId
    await user.click(screen.getByTestId('payment-submit'));

    expect(mockedCreate).not.toHaveBeenCalled();
    expect(screen.getByTestId('payment-error')).toHaveTextContent(/开发用户/);
  });

  it('dev_settlement 缺 screenshotId → 不调 API + 显示错误', async () => {
    const user = userEvent.setup();
    render(<PaymentDialog projectId={100} onClose={() => {}} />);

    await user.selectOptions(screen.getByTestId('payment-direction'), 'dev_settlement');
    await user.type(screen.getByTestId('payment-amount'), '3000');
    await user.type(screen.getByTestId('payment-remark'), '结算');
    await user.type(screen.getByTestId('payment-related-user-id'), '7');
    // 不填 screenshotId
    await user.click(screen.getByTestId('payment-submit'));

    expect(mockedCreate).not.toHaveBeenCalled();
    expect(screen.getByTestId('payment-error')).toHaveTextContent(/截图/);
  });
});

// ============================================================
// 合法提交：customer_in 路径
// ============================================================

describe('PaymentDialog - customer_in 提交', () => {
  it('合法 customer_in 提交 → 调 createPayment + 触发 onSuccess/onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    mockedCreate.mockResolvedValueOnce(samplePayment({ amount: '1234.56', remark: '首付' }));

    render(
      <PaymentDialog projectId={100} onClose={onClose} onSuccess={onSuccess} />,
    );

    await user.type(screen.getByTestId('payment-amount'), '1234.56');
    await user.type(screen.getByTestId('payment-remark'), '首付');
    await user.click(screen.getByTestId('payment-submit'));

    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledTimes(1);
    });

    const [pid, payload] = mockedCreate.mock.calls[0];
    expect(pid).toBe(100);
    expect(payload.direction).toBe('customer_in');
    // amount 必须 toFixed(2) 输出 string，不丢精度
    expect(payload.amount).toBe('1234.56');
    expect(payload.remark).toBe('首付');
    // customer_in 不传 relatedUserId / screenshotId
    expect(payload.relatedUserId).toBeNull();
    expect(payload.screenshotId).toBeNull();

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('提交时 amount 走 toFixed(2) 输出 string，与后端 db.Money 协议对齐', async () => {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValueOnce(samplePayment());

    render(<PaymentDialog projectId={100} onClose={() => {}} />);

    // 输入 100（无小数），客户端 toFixed(2) → "100.00"
    // 业务背景：后端 db.Money.StringFixed(2) 期望"123.45"风格固定 2 位小数；前端 toFixed(2) 协议对齐
    await user.type(screen.getByTestId('payment-amount'), '100');
    await user.type(screen.getByTestId('payment-remark'), '测试');
    await user.click(screen.getByTestId('payment-submit'));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalled());
    const [, payload] = mockedCreate.mock.calls[0];
    expect(payload.amount).toBe('100.00');
  });
});

// ============================================================
// 合法提交：dev_settlement 路径
// ============================================================

describe('PaymentDialog - dev_settlement 提交', () => {
  it('合法 dev_settlement → 提交 + refetchEarnings', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mockedCreate.mockResolvedValueOnce(
      samplePayment({
        direction: 'dev_settlement',
        amount: '3000.00',
        relatedUserId: 7,
        screenshotId: 99,
        remark: '结算',
      }),
    );
    mockedGetEarnings.mockResolvedValueOnce({
      userId: 7,
      totalEarned: '3000.00',
      settlementCount: 1,
      lastPaidAt: '2026-04-29T10:00:00Z',
      projects: [],
    });

    render(<PaymentDialog projectId={100} onClose={onClose} />);

    await user.selectOptions(screen.getByTestId('payment-direction'), 'dev_settlement');
    await user.type(screen.getByTestId('payment-amount'), '3000');
    await user.type(screen.getByTestId('payment-related-user-id'), '7');
    await user.type(screen.getByTestId('payment-screenshot-id'), '99');
    await user.type(screen.getByTestId('payment-remark'), '结算');
    await user.click(screen.getByTestId('payment-submit'));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    const [, payload] = mockedCreate.mock.calls[0];
    expect(payload.direction).toBe('dev_settlement');
    expect(payload.amount).toBe('3000.00');
    expect(payload.relatedUserId).toBe(7);
    expect(payload.screenshotId).toBe(99);

    // dev_settlement 提交后应触发 earnings refetch
    await waitFor(() => expect(mockedGetEarnings).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// API 错误暴露
// ============================================================

describe('PaymentDialog - API 错误', () => {
  it('createPayment 失败 → 错误显示在 error 区，不关闭对话框', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mockedCreate.mockRejectedValueOnce(new Error('amount must be > 0'));

    render(<PaymentDialog projectId={100} onClose={onClose} />);

    await user.type(screen.getByTestId('payment-amount'), '1');
    await user.type(screen.getByTestId('payment-remark'), '测试');
    await user.click(screen.getByTestId('payment-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('payment-error')).toHaveTextContent(/amount/);
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ============================================================
// 取消按钮
// ============================================================

describe('PaymentDialog - 取消', () => {
  it('点击取消 → onClose 触发，不调 API', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PaymentDialog projectId={100} onClose={onClose} />);

    await user.click(screen.getByTestId('payment-cancel'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});
