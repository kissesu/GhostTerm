/**
 * @file DetailTabs.test.tsx
 * @description DetailTabs 组件单测：5 个 tab 渲染 / 点击切换 / active 状态
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { DetailTabs } from '../DetailTabs';

describe('DetailTabs', () => {
  it('渲染 5 个 tab 按钮', () => {
    render(<DetailTabs active="timeline" onChange={vi.fn()} />);
    expect(screen.getByRole('tab', { name: '进度时间线' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '反馈' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '论文版本' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '文件' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '收款' })).toBeInTheDocument();
  });

  it('active="timeline" → timeline tab aria-selected=true', () => {
    render(<DetailTabs active="timeline" onChange={vi.fn()} />);
    const btn = screen.getByRole('tab', { name: '进度时间线' });
    expect(btn.getAttribute('aria-selected')).toBe('true');
    // 其它 tab 非 selected
    expect(screen.getByRole('tab', { name: '反馈' }).getAttribute('aria-selected')).toBe('false');
  });

  it('点击 tab → 调用 onChange(tabId)', async () => {
    const onChange = vi.fn();
    render(<DetailTabs active="timeline" onChange={onChange} />);
    await userEvent.click(screen.getByRole('tab', { name: '反馈' }));
    expect(onChange).toHaveBeenCalledWith('feedback');
  });
});
