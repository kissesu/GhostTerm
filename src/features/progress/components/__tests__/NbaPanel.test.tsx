/**
 * @file NbaPanel.test.tsx
 * @description NbaPanel 组件单测（mock PermissionGate 直渲 children 屏蔽权限检查）
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { NbaPanel } from '../NbaPanel';
import type { Project } from '../../api/projects';

// mock PermissionGate 直渲 children，屏蔽 progressPermissionStore 权限状态干扰
vi.mock('../PermissionGate', () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// 最小化 Project mock
function makeProject(overrides: Partial<Project> & { status: Project['status'] }): Project {
  const { status, ...rest } = overrides;
  return {
    id: 1,
    name: '测试项目',
    customerLabel: '客户A',
    description: '',
    priority: 'normal',
    status,
    deadline: '2026-12-31',
    dealingAt: '2026-01-01',
    originalQuote: '0',
    currentQuote: '0',
    afterSalesTotal: '0',
    totalReceived: '0',
    createdBy: 1,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...rest,
  };
}

describe('NbaPanel', () => {
  it('developing project → CTA "标记开发完成" + meta "预计 2 分钟" + "事件 E7"', () => {
    const project = makeProject({ status: 'developing' });
    render(<NbaPanel project={project} onTriggerAction={vi.fn()} />);
    expect(screen.getByTestId('nba-cta')).toHaveTextContent('标记开发完成');
    expect(screen.getByText('预计 2 分钟')).toBeInTheDocument();
    expect(screen.getByText('事件 E7')).toBeInTheDocument();
  });

  it('含 ★ 星标 SVG path（data-testid=nba-panel 内部）', () => {
    const project = makeProject({ status: 'developing' });
    const { container } = render(<NbaPanel project={project} onTriggerAction={vi.fn()} />);
    const panelEl = container.querySelector('[data-testid="nba-panel"]');
    expect(panelEl).not.toBeNull();
    // 星标路径特征：d 属性以 "M8 1l2.5 4.5" 开头
    const starPath = panelEl!.querySelector('path[d*="M8 1l2.5 4.5"]');
    expect(starPath).not.toBeNull();
  });

  it('点击 CTA → onTriggerAction(primaryAction)', async () => {
    const onTriggerAction = vi.fn();
    const project = makeProject({ status: 'developing' });
    render(<NbaPanel project={project} onTriggerAction={onTriggerAction} />);
    await userEvent.click(screen.getByTestId('nba-cta'));
    expect(onTriggerAction).toHaveBeenCalledOnce();
    // 确认传入的是 developing 的 primary action
    expect(onTriggerAction.mock.calls[0][0].eventCode).toBe('E7');
  });

  it('archived project → data-informational="true" + label "当前是终态"', () => {
    const project = makeProject({ status: 'archived' });
    render(<NbaPanel project={project} onTriggerAction={vi.fn()} />);
    const panel = screen.getByTestId('nba-panel');
    expect(panel.getAttribute('data-informational')).toBe('true');
    expect(screen.getByText('当前是终态')).toBeInTheDocument();
  });

  it('cancelled project → data-informational="true"', () => {
    const project = makeProject({ status: 'cancelled' });
    render(<NbaPanel project={project} onTriggerAction={vi.fn()} />);
    const panel = screen.getByTestId('nba-panel');
    expect(panel.getAttribute('data-informational')).toBe('true');
  });

  it('paid project → secondary actions 为空，不渲染 NbaSecondaryActions', () => {
    const project = makeProject({ status: 'paid' });
    render(<NbaPanel project={project} onTriggerAction={vi.fn()} />);
    // paid secondary=[]，NbaSecondaryActions 返回 null → 无"其它操作"按钮
    expect(screen.queryByRole('button', { name: /其它操作/ })).toBeNull();
  });

  it('非活跃 status data-informational="false"（developing）', () => {
    const project = makeProject({ status: 'developing' });
    render(<NbaPanel project={project} onTriggerAction={vi.fn()} />);
    const panel = screen.getByTestId('nba-panel');
    expect(panel.getAttribute('data-informational')).toBe('false');
  });

  it('未知 status → 渲染 fallback data-testid="nba-panel-fallback" + "未知状态" 文字', () => {
    // 强制传入不存在的 status
    const project = makeProject({ status: 'dealing' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (project as any).status = 'unknown_status';
    render(<NbaPanel project={project} onTriggerAction={vi.fn()} />);
    expect(screen.getByTestId('nba-panel-fallback')).toBeInTheDocument();
    expect(screen.getByText(/未知状态/)).toBeInTheDocument();
  });
});
