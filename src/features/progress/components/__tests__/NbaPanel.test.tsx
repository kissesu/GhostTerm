/**
 * @file NbaPanel.test.tsx
 * @description NBA 主面板渲染 + 主 CTA + 次级折叠 + terminal informational 行为
 * @author Atlas.oi
 * @date 2026-04-30
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

// Mock PermissionGate 直接渲染 children（测试不关心权限分支，由 PermissionGate 自己的测试覆盖）
vi.mock('../PermissionGate', () => ({
  PermissionGate: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { NbaPanel } from '../NbaPanel';
import type { Project } from '../../api/projects';

const mockProject = (status: Project['status']): Project => ({
  id: 1, status, currentQuote: '8000', totalReceived: '3000',
  // 其它字段按测试需求最小化
} as unknown as Project);

describe('NbaPanel', () => {
  it('developing 状态：渲染"标记开发完成"主 CTA', () => {
    render(<NbaPanel project={mockProject('developing')} onTriggerAction={vi.fn()} />);
    expect(screen.getByRole('button', { name: /标记开发完成/ })).toBeInTheDocument();
  });

  it('点击主 CTA → onTriggerAction(primaryAction)', async () => {
    const user = userEvent.setup();
    const handler = vi.fn();
    render(<NbaPanel project={mockProject('developing')} onTriggerAction={handler} />);
    await user.click(screen.getByRole('button', { name: /标记开发完成/ }));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].eventCode).toBe('E7');
  });

  it('archived 状态：渲染 informational 样式 + "客户报售后" CTA', () => {
    render(<NbaPanel project={mockProject('archived')} onTriggerAction={vi.fn()} />);
    expect(screen.getByTestId('nba-panel')).toHaveAttribute('data-informational', 'true');
    expect(screen.getByRole('button', { name: /客户报售后/ })).toBeInTheDocument();
  });

  it('developing 状态：渲染"其它操作"折叠（含 E12 取消）', async () => {
    const user = userEvent.setup();
    render(<NbaPanel project={mockProject('developing')} onTriggerAction={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /其它操作/ }));
    expect(screen.getByRole('button', { name: '取消项目' })).toBeVisible();
  });

  it('paid 状态：secondary 为空 → 不渲染折叠面板', () => {
    render(<NbaPanel project={mockProject('paid')} onTriggerAction={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /其它操作/ })).not.toBeInTheDocument();
  });

  it('未知 status → 渲染降级提示而非崩溃', () => {
    const { container } = render(
      <NbaPanel project={{ id: 1, status: 'invalid_status' as any } as Project} onTriggerAction={vi.fn()} />
    );
    expect(container).toHaveTextContent(/未知状态/);
    expect(screen.getByTestId('nba-panel-fallback')).toBeInTheDocument();
  });
});
