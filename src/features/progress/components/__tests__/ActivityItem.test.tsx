/**
 * @file ActivityItem.test.tsx
 * @description ActivityItem 路由器单测：按 kind 派发到对应渲染器
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import type { Activity } from '../../api/activities';
import { ActivityItem } from '../ActivityItem';

const base = {
  sourceId: 1,
  projectId: 1,
  occurredAt: '2026-05-01T08:00:00Z',
  actorId: 1,
  actorName: '小明',
  actorRoleName: '客服',
};

describe('ActivityItem', () => {
  it('feedback 类活动 → 路由到 FeedbackRenderer（出现 反馈 chip）', () => {
    const activity: Activity = {
      ...base,
      id: 'feedback:1',
      kind: 'feedback',
      payload: { content: '随手记一笔', source: 'phone', status: 'pending', attachmentCount: 0, attachments: [] },
    };
    render(<ActivityItem activity={activity} />);
    expect(screen.getByText('反馈')).toBeInTheDocument();
    // source 字段已删除（用户反馈 2026-05-03"不需要来源字段"）
  });

  it('status_change 类活动 → 路由到 StatusChangeRenderer（chip 显示目标流程名）', () => {
    const activity: Activity = {
      ...base,
      id: 'status_change:1',
      kind: 'status_change',
      payload: {
        eventCode: 'E_DEAL',
        eventName: '成交',
        fromStatus: 'quoting',
        toStatus: 'developing',
        remark: '签合同',
      },
    };
    render(<ActivityItem activity={activity} />);
    // chip 显示目标流程名（用户反馈 2026-05-03"状态 tag 应该使用实际的流程名"）
    expect(screen.getByText('开发中')).toBeInTheDocument();
    expect(screen.getByText(/「报价中」.*「开发中」/)).toBeInTheDocument();
  });
});
