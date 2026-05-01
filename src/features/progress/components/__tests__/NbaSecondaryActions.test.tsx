/**
 * @file NbaSecondaryActions.test.tsx
 * @description 折叠次级动作面板，验证 a11y aria-expanded + 键盘可达
 * @author Atlas.oi
 * @date 2026-04-30
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NbaSecondaryActions } from '../NbaSecondaryActions';
import type { ActionMeta } from '../../config/nbaConfig';

const mockActions: ActionMeta[] = [
  {
    eventCode: 'E12', label: '取消项目', modalTitle: '取消项目',
    transitionTo: 'cancelled', kind: 'critical', permCode: 'event:E12',
    fields: [{ name: 'note', label: '原因', type: 'textarea', required: true }],
  },
];

describe('NbaSecondaryActions', () => {
  it('折叠头是 <button> 元素（不是 div）', () => {
    render(<NbaSecondaryActions actions={mockActions} onTrigger={vi.fn()} />);
    const head = screen.getByRole('button', { name: /其它操作/ });
    expect(head.tagName).toBe('BUTTON');
  });

  it('默认折叠：aria-expanded=false + 列表不可见', () => {
    render(<NbaSecondaryActions actions={mockActions} onTrigger={vi.fn()} />);
    const head = screen.getByRole('button', { name: /其它操作/ });
    expect(head).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('取消项目')).not.toBeVisible();
  });

  it('键盘 Enter 展开 → aria-expanded=true', async () => {
    const user = userEvent.setup();
    render(<NbaSecondaryActions actions={mockActions} onTrigger={vi.fn()} />);
    const head = screen.getByRole('button', { name: /其它操作/ });
    head.focus();
    await user.keyboard('{Enter}');
    expect(head).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('取消项目')).toBeVisible();
  });

  it('点 secondary 动作按钮 → onTrigger(action)', async () => {
    const onTrigger = vi.fn();
    const user = userEvent.setup();
    render(<NbaSecondaryActions actions={mockActions} onTrigger={onTrigger} />);
    await user.click(screen.getByRole('button', { name: /其它操作/ }));
    await user.click(screen.getByRole('button', { name: '取消项目' }));
    expect(onTrigger).toHaveBeenCalledWith(mockActions[0]);
  });

  it('actions 为空 → 不渲染（返回 null）', () => {
    const { container } = render(<NbaSecondaryActions actions={[]} onTrigger={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
