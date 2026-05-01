/**
 * @file feedbacksStore.test.ts
 * @description feedbacksStore 行为契约
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../api/feedbacks', () => ({
  listFeedbacks: vi.fn(),
  createFeedback: vi.fn(),
}));

import { useFeedbacksStore } from '../feedbacksStore';
import { listFeedbacks, createFeedback } from '../../api/feedbacks';

beforeEach(() => {
  useFeedbacksStore.getState().clear();
  vi.resetAllMocks();
});

describe('feedbacksStore', () => {
  it('loadByProject 写入对应项目的反馈列表', async () => {
    const mockList = [
      { id: 1, projectId: 42, content: 'first' } as any,
      { id: 2, projectId: 42, content: 'second' } as any,
    ];
    vi.mocked(listFeedbacks).mockResolvedValue(mockList);
    await useFeedbacksStore.getState().loadByProject(42);
    const list = useFeedbacksStore.getState().byProject.get(42);
    expect(list).toHaveLength(2);
    expect(list?.[0].id).toBe(1);
  });

  it('add 追加到末尾', async () => {
    useFeedbacksStore.setState({
      byProject: new Map([[1, [{ id: 1, projectId: 1 } as any]]]),
    });
    const newFb = { id: 2, projectId: 1 } as any;
    vi.mocked(createFeedback).mockResolvedValue(newFb);
    await useFeedbacksStore.getState().add(1, { content: 'x', source: 'wechat', status: 'pending' });
    const list = useFeedbacksStore.getState().byProject.get(1);
    expect(list).toHaveLength(2);
    expect(list?.[1].id).toBe(2);
  });

  it('loadByProject 失败后 errorByProject 有值且 loading 清除', async () => {
    vi.mocked(listFeedbacks).mockRejectedValue(new Error('load failed'));
    await useFeedbacksStore.getState().loadByProject(5);
    expect(useFeedbacksStore.getState().errorByProject.get(5)).toBe('load failed');
    expect(useFeedbacksStore.getState().loadingByProject.has(5)).toBe(false);
  });

  it('clear 重置所有状态', () => {
    useFeedbacksStore.setState({
      byProject: new Map([[1, [{ id: 1 } as any]]]),
      errorByProject: new Map([[1, 'err']]),
    });
    useFeedbacksStore.getState().clear();
    expect(useFeedbacksStore.getState().byProject.size).toBe(0);
    expect(useFeedbacksStore.getState().errorByProject.size).toBe(0);
  });
});
