/**
 * @file KanbanView.test.tsx
 * @description KanbanView 单测：5列固定渲染 / CTA 弹出 dialog / 点卡进详情
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KanbanView } from '../KanbanView';

// mock EventTriggerDialog 简化测试（避免 store 依赖）
vi.mock('../EventTriggerDialog', () => ({
  EventTriggerDialog: ({ eventLabel }: { eventLabel: string }) => (
    <div data-testid="event-dialog">{eventLabel}</div>
  ),
}));

// mock PermissionGate 直渲 children
vi.mock('../PermissionGate', () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// mock projectsStore
const mockLoadAll = vi.fn();
const mockProjects = new Map([
  [
    1,
    {
      id: 1,
      name: '开发项目A',
      customerLabel: '客户A',
      description: '',
      priority: 'normal' as const,
      status: 'developing' as const,
      deadline: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      dealingAt: '2026-01-01',
      originalQuote: '0',
      currentQuote: '0',
      afterSalesTotal: '0',
      totalReceived: '0',
      createdBy: 1,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  ],
]);

vi.mock('../../stores/projectsStore', () => ({
  useProjectsStore: (selector: (s: object) => unknown) =>
    selector({ projects: mockProjects, loadAll: mockLoadAll }),
}));

// mock progressUiStore
const mockOpenProjectFromView = vi.fn();
vi.mock('../../stores/progressUiStore', () => ({
  useProgressUiStore: (selector: (s: object) => unknown) =>
    selector({ openProjectFromView: mockOpenProjectFromView }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('KanbanView', () => {
  it('渲染 5 个固定列（即使某列为空也要显示 col-head）', () => {
    render(<KanbanView />);
    expect(screen.getByText('洽谈')).toBeInTheDocument();
    expect(screen.getByText('报价')).toBeInTheDocument();
    expect(screen.getByText('开发中')).toBeInTheDocument();
    expect(screen.getByText('验收')).toBeInTheDocument();
    expect(screen.getByText('已交付')).toBeInTheDocument();
  });

  it('developing 列有 KanbanCard 显示 "标记开发完成" CTA', () => {
    render(<KanbanView />);
    // cardCta 按钮文案包含 "标记开发完成"
    const btns = screen.getAllByRole('button');
    const ctaBtn = btns.find((b) => b.textContent?.includes('标记开发完成'));
    expect(ctaBtn).toBeTruthy();
  });

  it('点卡片 → 调 openProjectFromView(id, "kanban")', async () => {
    render(<KanbanView />);
    // 找 data-project-id=1 的卡片容器
    const card = document.querySelector('[data-project-id="1"]') as HTMLElement;
    await userEvent.click(card);
    expect(mockOpenProjectFromView).toHaveBeenCalledWith(1, 'kanban');
  });

  it('点 CTA → 不调 openProjectFromView，dialog 弹出', async () => {
    render(<KanbanView />);
    const btns = screen.getAllByRole('button');
    const ctaBtn = btns.find((b) => b.tagName === 'BUTTON' && b.textContent?.includes('标记开发完成')) as HTMLElement;
    await userEvent.click(ctaBtn);
    expect(mockOpenProjectFromView).not.toHaveBeenCalled();
    expect(screen.getByTestId('event-dialog')).toBeInTheDocument();
  });

  it('mount 后调用 loadAll', () => {
    render(<KanbanView />);
    expect(mockLoadAll).toHaveBeenCalledOnce();
  });
});
