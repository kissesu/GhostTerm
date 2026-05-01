/**
 * @file paymentsStore.test.ts
 * @description paymentsStore 行为契约
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../api/payments', () => ({
  listProjectPayments: vi.fn(),
  createPayment: vi.fn(),
}));

import { usePaymentsStore } from '../paymentsStore';
import { listProjectPayments, createPayment } from '../../api/payments';

beforeEach(() => {
  usePaymentsStore.getState().clear();
  vi.resetAllMocks();
});

describe('paymentsStore', () => {
  it('loadByProject 写入对应项目的收款列表', async () => {
    const mockList = [
      { id: 1, projectId: 10, amount: '500.00' } as any,
      { id: 2, projectId: 10, amount: '300.00' } as any,
    ];
    vi.mocked(listProjectPayments).mockResolvedValue(mockList);
    await usePaymentsStore.getState().loadByProject(10);
    const list = usePaymentsStore.getState().byProject.get(10);
    expect(list).toHaveLength(2);
    expect(list?.[0].amount).toBe('500.00');
  });

  it('loadByProject 失败后 errorByProject 有值且 loading 清除', async () => {
    vi.mocked(listProjectPayments).mockRejectedValue(new Error('network error'));
    await usePaymentsStore.getState().loadByProject(7);
    expect(usePaymentsStore.getState().errorByProject.get(7)).toBe('network error');
    expect(usePaymentsStore.getState().loadingByProject.has(7)).toBe(false);
  });

  it('addPayment 追加到末尾', async () => {
    usePaymentsStore.setState({
      byProject: new Map([[1, [{ id: 1, projectId: 1, amount: '100.00' } as any]]]),
    });
    const newPayment = { id: 2, projectId: 1, amount: '200.00' } as any;
    vi.mocked(createPayment).mockResolvedValue(newPayment);
    const payload = {
      direction: 'customer_in' as const,
      amount: '200.00',
      paidAt: '2026-05-01T00:00:00Z',
      remark: 'test',
    };
    await usePaymentsStore.getState().addPayment(1, payload);
    const list = usePaymentsStore.getState().byProject.get(1);
    expect(list).toHaveLength(2);
    expect(list?.[1].amount).toBe('200.00');
  });

  it('loadByProject 期间 loading 状态正确', async () => {
    let resolve!: (v: any[]) => void;
    const p = new Promise<any[]>((res) => { resolve = res; });
    vi.mocked(listProjectPayments).mockReturnValue(p);

    const loadPromise = usePaymentsStore.getState().loadByProject(3);
    expect(usePaymentsStore.getState().loadingByProject.has(3)).toBe(true);

    resolve([]);
    await loadPromise;
    expect(usePaymentsStore.getState().loadingByProject.has(3)).toBe(false);
  });

  it('clear 重置所有状态', () => {
    usePaymentsStore.setState({
      byProject: new Map([[1, [{ id: 1 } as any]]]),
      errorByProject: new Map([[1, 'err']]),
    });
    usePaymentsStore.getState().clear();
    expect(usePaymentsStore.getState().byProject.size).toBe(0);
    expect(usePaymentsStore.getState().errorByProject.size).toBe(0);
  });
});
