/**
 * @file activitiesStore.test.ts
 * @description activitiesStore 行为契约：首次替换、cursor 去重 append、invalidate 重拉、错误路径
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/activities', () => ({
  getActivities: vi.fn(),
}));

import { useActivitiesStore } from '../activitiesStore';
import type { Activity } from '../../api/activities';
import { getActivities } from '../../api/activities';

// 构造 feedback 类型 Activity，方便复用
function mockFeedback(id: string): Activity {
  return {
    id,
    sourceId: Number(id.split(':')[1]),
    projectId: 1,
    kind: 'feedback',
    occurredAt: '2026-05-01T00:00:00Z',
    actorId: 1,
    payload: { content: 'x', source: 'wechat', status: 'pending' },
  };
}

beforeEach(() => {
  // 重置 store 到初始状态；vi.resetAllMocks 清掉测试间的 mock 调用记录
  useActivitiesStore.setState({ byProject: new Map() });
  vi.resetAllMocks();
});

describe('activitiesStore', () => {
  it('loadActivities 首次调用整桶替换 items', async () => {
    vi.mocked(getActivities).mockResolvedValue({
      items: [mockFeedback('feedback:1')],
      nextCursor: 'cursor1',
    });
    await useActivitiesStore.getState().loadActivities(1);
    const state = useActivitiesStore.getState().byProject.get(1)!;
    expect(state.items).toHaveLength(1);
    expect(state.nextCursor).toBe('cursor1');
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('loadActivities 带 cursor 时 append 并按 id 去重', async () => {
    vi.mocked(getActivities)
      .mockResolvedValueOnce({
        items: [mockFeedback('feedback:1')],
        nextCursor: 'c1',
      })
      // 第二次返回包含与第一次重叠的 id（feedback:1）+ 一个新 id
      .mockResolvedValueOnce({
        items: [mockFeedback('feedback:1'), mockFeedback('feedback:2')],
        nextCursor: null,
      });

    await useActivitiesStore.getState().loadActivities(1);
    await useActivitiesStore.getState().loadActivities(1, 'c1');

    const state = useActivitiesStore.getState().byProject.get(1)!;
    expect(state.items.map((i) => i.id)).toEqual(['feedback:1', 'feedback:2']);
    expect(state.nextCursor).toBeNull();
  });

  it('invalidate 清空旧 items 并立即重拉首页', async () => {
    vi.mocked(getActivities).mockResolvedValue({
      items: [mockFeedback('feedback:9')],
      nextCursor: null,
    });
    // 预置一个非空状态，验证 invalidate 真的清空了旧数据
    useActivitiesStore.setState({
      byProject: new Map([
        [
          1,
          {
            items: [mockFeedback('feedback:1')],
            nextCursor: null,
            loading: false,
            error: null,
          },
        ],
      ]),
    });

    await useActivitiesStore.getState().invalidate(1);

    const state = useActivitiesStore.getState().byProject.get(1)!;
    // 重拉后只剩 feedback:9，旧 feedback:1 被清空
    expect(state.items.map((i) => i.id)).toEqual(['feedback:9']);
  });

  it('error 路径写入 error 字符串并清 loading', async () => {
    vi.mocked(getActivities).mockRejectedValue(new Error('boom'));
    await useActivitiesStore.getState().loadActivities(1);
    const state = useActivitiesStore.getState().byProject.get(1)!;
    expect(state.error).toBe('boom');
    expect(state.loading).toBe(false);
  });
});
