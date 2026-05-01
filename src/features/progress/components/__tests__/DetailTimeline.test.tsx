/**
 * @file DetailTimeline.test.tsx
 * @description DetailTimeline 组件单测：空状态 / 渲染列表 / 最新在顶
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DetailTimeline } from '../DetailTimeline';
import type { Feedback } from '../../api/feedbacks';

function makeFeedback(id: number, content: string, daysAgo = 0): Feedback {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  return {
    id,
    projectId: 1,
    content,
    source: 'wechat',
    status: 'pending',
    recordedBy: 1,
    recordedAt: d.toISOString(),
    attachmentIds: [],
  };
}

describe('DetailTimeline', () => {
  it('空数组 → 显示"暂无活动"', () => {
    render(<DetailTimeline feedbacks={[]} />);
    expect(screen.getByText('暂无活动')).toBeInTheDocument();
  });

  it('渲染 feedback content 文本', () => {
    const feedbacks = [makeFeedback(1, '第一条反馈'), makeFeedback(2, '第二条反馈')];
    render(<DetailTimeline feedbacks={feedbacks} />);
    expect(screen.getByText('第一条反馈')).toBeInTheDocument();
    expect(screen.getByText('第二条反馈')).toBeInTheDocument();
  });

  it('最新在顶（reverse 顺序）', () => {
    // feedbacks 按 ASC 排序：id=1 最早，id=2 最新
    const feedbacks = [makeFeedback(1, '较早反馈', 5), makeFeedback(2, '最新反馈', 0)];
    render(<DetailTimeline feedbacks={feedbacks} />);
    const items = screen.getAllByText(/反馈/);
    // "最新反馈" 应该排在 "较早反馈" 之前（dom 顺序）
    const allText = items.map((el) => el.textContent ?? '').join(' ');
    // "最新反馈" 在文本流中应排在 "较早反馈" 前
    expect(allText.indexOf('最新反馈')).toBeLessThan(allText.indexOf('较早反馈'));
  });
});
