/**
 * @file KanbanCard.test.tsx
 * @description KanbanCard 组件单测：渲染字段 / 点 card → onOpenDetail / 点 CTA → onTriggerCta
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { KanbanCard } from '../KanbanCard';
import type { Project } from '../../api/projects';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 42,
    name: '测试论文项目',
    customerLabel: '张三',
    description: '',
    priority: 'normal',
    status: 'developing',
    deadline: new Date(Date.now() + 20 * 86_400_000).toISOString(), // 20天后
    dealingAt: '2026-01-01',
    originalQuote: '8000',
    currentQuote: '8000',
    afterSalesTotal: '0',
    totalReceived: '0',
    createdBy: 1,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    thesisLevel: 'master',
    ...overrides,
  };
}

describe('KanbanCard', () => {
  it('渲染 name + customerLabel + thesisLevel + deadline tag', () => {
    render(
      <KanbanCard
        project={makeProject()}
        onOpenDetail={vi.fn()}
        onTriggerCta={vi.fn()}
      />,
    );
    expect(screen.getByText('测试论文项目')).toBeInTheDocument();
    expect(screen.getByText('张三')).toBeInTheDocument();
    expect(screen.getByText('master')).toBeInTheDocument();
    // CTA 按钮文案 = developing 的 primary action label（找 native <button> 元素）
    const ctaBtn = screen.getAllByRole('button').find((el) => el.tagName === 'BUTTON');
    expect(ctaBtn).toBeTruthy();
    expect(ctaBtn!.textContent).toContain('标记开发完成');
  });

  it('点 card → 调用 onOpenDetail(id)，不调 onTriggerCta', async () => {
    const onOpenDetail = vi.fn();
    const onTriggerCta = vi.fn();
    const { container } = render(
      <KanbanCard
        project={makeProject()}
        onOpenDetail={onOpenDetail}
        onTriggerCta={onTriggerCta}
      />,
    );
    // 点卡片容器（role=button div）而非 CTA 按钮
    const card = container.querySelector('[data-project-id="42"]') as HTMLElement;
    await userEvent.click(card);
    expect(onOpenDetail).toHaveBeenCalledWith(42);
    expect(onTriggerCta).not.toHaveBeenCalled();
  });

  it('点 CTA 按钮 → 调用 onTriggerCta，不调 onOpenDetail（stopPropagation）', async () => {
    const onOpenDetail = vi.fn();
    const onTriggerCta = vi.fn();
    render(
      <KanbanCard
        project={makeProject()}
        onOpenDetail={onOpenDetail}
        onTriggerCta={onTriggerCta}
      />,
    );
    // 找 native <button> 元素（非 role=button div）
    const ctaBtn = screen.getAllByRole('button').find((el) => el.tagName === 'BUTTON') as HTMLElement;
    await userEvent.click(ctaBtn);
    expect(onTriggerCta).toHaveBeenCalledOnce();
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it('deadline 已超期（负数）→ deadlineHot class 出现在 deadline tag', () => {
    const project = makeProject({
      deadline: new Date(Date.now() - 2 * 86_400_000).toISOString(), // 2天前已超期
    });
    const { container } = render(
      <KanbanCard project={project} onOpenDetail={vi.fn()} onTriggerCta={vi.fn()} />,
    );
    // deadline span 应含 deadlineHot 相关 class
    const tags = container.querySelectorAll('[class*="deadlineHot"]');
    expect(tags.length).toBeGreaterThan(0);
  });
});
