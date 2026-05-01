/**
 * @file earningsStore.test.ts
 * @description earningsStore 行为契约
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../api/earnings', () => ({
  getMyEarnings: vi.fn(),
}));

import { useEarningsStore } from '../earningsStore';
import { getMyEarnings } from '../../api/earnings';

beforeEach(() => {
  useEarningsStore.getState().clear();
  vi.resetAllMocks();
});

describe('earningsStore', () => {
  it('load 成功后 summary 设值且 loading=false', async () => {
    const mockSummary = {
      totalReceived: '5000.00',
      totalPending: '1000.00',
      projects: [],
    } as any;
    vi.mocked(getMyEarnings).mockResolvedValue(mockSummary);
    await useEarningsStore.getState().load();
    const s = useEarningsStore.getState();
    expect(s.summary).toEqual(mockSummary);
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
  });

  it('load 失败后 error 设值且 loading=false', async () => {
    vi.mocked(getMyEarnings).mockRejectedValue(new Error('unauthorized'));
    await useEarningsStore.getState().load();
    const s = useEarningsStore.getState();
    expect(s.error).toBe('unauthorized');
    expect(s.loading).toBe(false);
    expect(s.summary).toBeNull();
  });

  it('clear 重置所有状态', async () => {
    useEarningsStore.setState({
      summary: { totalReceived: '100.00' } as any,
      loading: true,
      error: 'some error',
    });
    useEarningsStore.getState().clear();
    const s = useEarningsStore.getState();
    expect(s.summary).toBeNull();
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
  });
});
