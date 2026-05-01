/**
 * @file ViewBar.test.tsx
 * @description ViewBar 组件单测 - kanban/detail 两种模式
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ViewBar } from '../ViewBar';

describe('ViewBar - kanban 模式', () => {
  it('渲染 "看板 · X 单进行中"', () => {
    render(<ViewBar mode="kanban" activeProjectCount={5} />);
    expect(screen.getByText('看板')).toBeInTheDocument();
    expect(screen.getByText('·')).toBeInTheDocument();
    expect(screen.getByText('5 单进行中')).toBeInTheDocument();
  });

  it('activeProjectCount 未提供时显示 0', () => {
    render(<ViewBar mode="kanban" />);
    expect(screen.getByText('0 单进行中')).toBeInTheDocument();
  });

  it('kanban 模式不渲染返回按钮', () => {
    render(<ViewBar mode="kanban" activeProjectCount={3} />);
    expect(screen.queryByRole('button', { name: /返回看板/ })).toBeNull();
  });
});

describe('ViewBar - detail 模式', () => {
  it('渲染面包屑 "看板 / 项目名"', () => {
    render(<ViewBar mode="detail" projectTitle="测试项目A" onBack={vi.fn()} />);
    expect(screen.getByText('看板')).toBeInTheDocument();
    expect(screen.getByText('/')).toBeInTheDocument();
    expect(screen.getByText('测试项目A')).toBeInTheDocument();
  });

  it('渲染返回按钮且点击触发 onBack', async () => {
    const onBack = vi.fn();
    render(<ViewBar mode="detail" projectTitle="项目B" onBack={onBack} />);
    const btn = screen.getByRole('button', { name: /返回看板/ });
    expect(btn).toBeInTheDocument();
    await userEvent.click(btn);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('detail 模式无 onBack 时不渲染返回按钮', () => {
    render(<ViewBar mode="detail" projectTitle="项目C" />);
    // 无 onBack 时不渲染 <button>（只有面包屑中的 <a role="button">）
    expect(screen.queryByRole('button', { name: /返回看板/ })).toBeNull();
  });
});
