/**
 * @file quoteChangesStore.test.ts
 * @description quoteChangesStore 行为契约
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../api/quotes', () => ({
  listQuoteChanges: vi.fn(),
  createQuoteChange: vi.fn(),
}));

import { useQuoteChangesStore } from '../quoteChangesStore';
import { listQuoteChanges, createQuoteChange } from '../../api/quotes';

beforeEach(() => {
  useQuoteChangesStore.getState().clear();
  vi.resetAllMocks();
});

describe('quoteChangesStore', () => {
  it('loadByProject 写入对应项目的费用变更列表', async () => {
    const mockList = [
      { id: 1, projectId: 10, changeType: 'append', delta: '500.00' } as any,
      { id: 2, projectId: 10, changeType: 'modify', newQuote: '2000.00' } as any,
    ];
    vi.mocked(listQuoteChanges).mockResolvedValue(mockList);
    await useQuoteChangesStore.getState().loadByProject(10);
    const list = useQuoteChangesStore.getState().byProject.get(10);
    expect(list).toHaveLength(2);
    expect(list?.[0].changeType).toBe('append');
  });

  it('loadByProject 失败后 errorByProject 有值且 loading 清除', async () => {
    vi.mocked(listQuoteChanges).mockRejectedValue(new Error('not found'));
    await useQuoteChangesStore.getState().loadByProject(99);
    expect(useQuoteChangesStore.getState().errorByProject.get(99)).toBe('not found');
    expect(useQuoteChangesStore.getState().loadingByProject.has(99)).toBe(false);
  });

  it('addQuoteChange 追加到末尾', async () => {
    useQuoteChangesStore.setState({
      byProject: new Map([[1, [{ id: 1, changeType: 'append' } as any]]]),
    });
    const newChange = { id: 2, projectId: 1, changeType: 'modify' } as any;
    vi.mocked(createQuoteChange).mockResolvedValue(newChange);
    await useQuoteChangesStore.getState().addQuoteChange(1, {
      changeType: 'modify',
      newQuote: '3000.00',
      reason: 'scope change',
    });
    const list = useQuoteChangesStore.getState().byProject.get(1);
    expect(list).toHaveLength(2);
    expect(list?.[1].changeType).toBe('modify');
  });

  it('loadByProject 期间 loading 状态正确', async () => {
    let resolve!: (v: any[]) => void;
    const p = new Promise<any[]>((res) => { resolve = res; });
    vi.mocked(listQuoteChanges).mockReturnValue(p);

    const loadPromise = useQuoteChangesStore.getState().loadByProject(3);
    expect(useQuoteChangesStore.getState().loadingByProject.has(3)).toBe(true);

    resolve([]);
    await loadPromise;
    expect(useQuoteChangesStore.getState().loadingByProject.has(3)).toBe(false);
  });

  it('clear 重置所有状态', () => {
    useQuoteChangesStore.setState({
      byProject: new Map([[1, [{ id: 1 } as any]]]),
      errorByProject: new Map([[1, 'err']]),
    });
    useQuoteChangesStore.getState().clear();
    expect(useQuoteChangesStore.getState().byProject.size).toBe(0);
    expect(useQuoteChangesStore.getState().errorByProject.size).toBe(0);
  });
});
