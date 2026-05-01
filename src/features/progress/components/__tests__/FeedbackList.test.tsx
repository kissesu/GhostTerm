/**
 * @file FeedbackList.test.tsx
 * @description FeedbackList 单测：
 *              byProject 空 → "暂无反馈" / 注入数据后渲染条目 /
 *              最新在顶顺序 / loadByProject 被调用
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { FeedbackList } from '../FeedbackList';
import type { Feedback } from '../../api/feedbacks';

// 顶层 mock；各 test 通过更新 mockState 控制返回值
const mockLoad = vi.fn();
let mockByProject: Map<number, Feedback[]> = new Map();

vi.mock('../../stores/feedbacksStore', () => ({
  useFeedbacksStore: (selector: (s: object) => unknown) =>
    selector({ byProject: mockByProject, loadByProject: mockLoad }),
}));

// 测试用 Feedback 工厂
function makeFeedback(id: number, content: string, recordedAt: string): Feedback {
  return {
    id,
    projectId: 1,
    content,
    source: 'wechat',
    status: 'pending',
    recordedBy: 1,
    recordedAt,
    attachmentIds: [],
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // 重置 mock 状态
  mockByProject = new Map();
});

describe('FeedbackList', () => {
  it('byProject 无数据时显示"暂无反馈"', () => {
    mockByProject = new Map();
    render(<FeedbackList projectId={1} />);
    expect(screen.getByText('暂无反馈')).toBeInTheDocument();
  });

  it('注入两条反馈后均渲染', () => {
    const fb1 = makeFeedback(1, '第一条反馈', '2026-04-01T10:00:00Z');
    const fb2 = makeFeedback(2, '第二条反馈', '2026-04-02T10:00:00Z');
    mockByProject = new Map([[1, [fb1, fb2]]]);
    render(<FeedbackList projectId={1} />);
    expect(screen.getByText('第一条反馈')).toBeInTheDocument();
    expect(screen.getByText('第二条反馈')).toBeInTheDocument();
  });

  it('列表为 ASC 存储，reverse 后最新（recordedAt 更晚）显示在最前', () => {
    const older = makeFeedback(1, '旧反馈文字', '2026-01-01T00:00:00Z');
    const newer = makeFeedback(2, '新反馈文字', '2026-06-01T00:00:00Z');
    // 存储为 ASC（older 在前，newer 在后），FeedbackList.reverse() 后 newer 应在顶
    mockByProject = new Map([[1, [older, newer]]]);
    const { container } = render(<FeedbackList projectId={1} />);

    const newEl = container.querySelector('[data-testid="feedback-new反馈文字"]') as HTMLElement | null;
    // 退而用 innerHTML 顺序判断：新反馈文字出现位置应先于旧反馈文字
    const html = container.innerHTML;
    const newPos = html.indexOf('新反馈文字');
    const oldPos = html.indexOf('旧反馈文字');
    expect(newPos).toBeGreaterThan(-1);
    expect(oldPos).toBeGreaterThan(-1);
    expect(newPos).toBeLessThan(oldPos);
    void newEl; // suppress unused
  });

  it('mount 后调用 loadByProject(projectId)', () => {
    mockByProject = new Map();
    render(<FeedbackList projectId={3} />);
    expect(mockLoad).toHaveBeenCalledWith(3);
  });
});
