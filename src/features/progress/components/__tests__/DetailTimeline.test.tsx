/**
 * @file DetailTimeline.test.tsx
 * @description DetailTimeline 单测：empty / items / error+retry 三态
 *
 *              通过 useActivitiesStore.setState 直接注入 byProject Map，
 *              覆盖三个分支；loadActivities 用 vi.fn 截获验证 retry 行为。
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DetailTimeline } from '../DetailTimeline';
import type { Activity } from '../../api/activities';
import { useActivitiesStore, type ActivityState } from '../../stores/activitiesStore';

const PROJECT_ID = 7;

function setStoreState(state: ActivityState | undefined): void {
  const map = new Map<number, ActivityState>();
  if (state) map.set(PROJECT_ID, state);
  useActivitiesStore.setState({ byProject: map });
}

beforeEach(() => {
  // 每个 case 重置 store + 替换 loadActivities，避免跨 case 污染
  useActivitiesStore.setState({
    byProject: new Map(),
    loadActivities: vi.fn().mockResolvedValue(undefined),
  });
});

describe('DetailTimeline', () => {
  it('items 为空时显示"当前项目暂无进度动态"', () => {
    setStoreState({
      items: [],
      nextCursor: null,
      loading: false,
      error: null,
    });
    render(<DetailTimeline projectId={PROJECT_ID} />);
    expect(screen.getByText('当前项目暂无进度动态')).toBeInTheDocument();
  });

  it('渲染 store 中的活动条目（feedback content 可见）', () => {
    const feedbackActivity: Activity = {
      id: 'feedback:1',
      sourceId: 1,
      projectId: PROJECT_ID,
      kind: 'feedback',
      occurredAt: '2026-05-01T08:00:00Z',
      actorId: 1,
      actorName: '张三',
      actorRoleName: '业务',
      payload: {
        content: '客户已确认',
        source: 'wechat',
        status: 'pending',
      },
    };
    setStoreState({
      items: [feedbackActivity],
      nextCursor: null,
      loading: false,
      error: null,
    });
    render(<DetailTimeline projectId={PROJECT_ID} />);
    expect(screen.getByText('反馈')).toBeInTheDocument();
    expect(screen.getByText('客户已确认')).toBeInTheDocument();
  });

  it('error 状态显示重试链接，点击调 loadActivities', async () => {
    const loadActivities = vi.fn().mockResolvedValue(undefined);
    useActivitiesStore.setState({
      byProject: new Map([
        [
          PROJECT_ID,
          {
            items: [],
            nextCursor: null,
            loading: false,
            error: 'Network error',
          },
        ],
      ]),
      loadActivities,
    });

    render(<DetailTimeline projectId={PROJECT_ID} />);
    expect(screen.getByText(/动态加载失败/)).toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: '点击重试' });
    await userEvent.click(retryBtn);
    expect(loadActivities).toHaveBeenCalledWith(PROJECT_ID);
  });
});
