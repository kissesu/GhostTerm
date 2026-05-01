/**
 * @file NbaSecondaryActions.test.tsx
 * @description NbaSecondaryActions 折叠次级动作面板单测
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { NbaSecondaryActions } from '../NbaSecondaryActions';
import type { ActionMeta } from '../../config/nbaConfig';

const mockActions: ActionMeta[] = [
  {
    eventCode: 'E12',
    label: '取消项目',
    modalTitle: '取消项目',
    transitionTo: 'cancelled',
    meta: '预计 1 分钟',
    kind: 'critical',
    permCode: 'event:E12',
    fields: [],
  },
  {
    eventCode: 'E8',
    label: '客户要修改',
    modalTitle: '客户要修改',
    transitionTo: 'developing',
    meta: '预计 1 分钟',
    kind: 'optional',
    permCode: 'event:E8',
    fields: [],
  },
];

describe('NbaSecondaryActions', () => {
  it('actions=[] 时返回 null（不渲染任何 DOM）', () => {
    const { container } = render(<NbaSecondaryActions actions={[]} onTrigger={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('折叠头是 BUTTON 元素，默认 aria-expanded=false', () => {
    render(<NbaSecondaryActions actions={mockActions} onTrigger={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /其它操作/ });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('点击折叠头后 aria-expanded=true，动作列表可见', async () => {
    render(<NbaSecondaryActions actions={mockActions} onTrigger={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /其它操作/ });
    await userEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    // 展开后动作按钮可见
    expect(screen.getByText('取消项目')).toBeInTheDocument();
    expect(screen.getByText('客户要修改')).toBeInTheDocument();
  });

  it('点击 secondary 按钮触发 onTrigger(action)', async () => {
    const onTrigger = vi.fn();
    render(<NbaSecondaryActions actions={mockActions} onTrigger={onTrigger} />);
    // 先展开
    await userEvent.click(screen.getByRole('button', { name: /其它操作/ }));
    // 点击取消项目
    await userEvent.click(screen.getByText('取消项目'));
    expect(onTrigger).toHaveBeenCalledOnce();
    expect(onTrigger).toHaveBeenCalledWith(mockActions[0]);
  });

  it('kind=critical 的 action 使用 danger class（不验证 CSS，只验证按钮内容被渲染）', async () => {
    render(<NbaSecondaryActions actions={mockActions} onTrigger={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /其它操作/ }));
    // 取消项目按钮应存在于 DOM
    const cancelBtn = screen.getByText('取消项目').closest('button');
    expect(cancelBtn).toBeInTheDocument();
  });

  it('再次点击折叠头后收起，aria-expanded=false', async () => {
    render(<NbaSecondaryActions actions={mockActions} onTrigger={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /其它操作/ });
    await userEvent.click(btn); // 展开
    await userEvent.click(btn); // 收起
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });
});
