/**
 * @file tab-switching.integration.test.tsx
 * @description tab 切换后原 workspace 不卸载（保活）验证
 * @author Atlas.oi
 * @date 2026-04-17
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useTabStore } from '../shared/stores/tabStore';
import { WorkspaceRouter } from '../layouts/WorkspaceRouter';
import { TabNav } from '../shared/components/TabNav';

vi.mock('../layouts/ProjectWorkspace', () => ({
  ProjectWorkspace: () => <div data-testid="project-workspace">project-content</div>,
}));

describe('tab 切换保活集成', () => {
  beforeEach(() => {
    useTabStore.setState({ activeTab: 'project' });
  });

  it('切换到 tools 后 project workspace 仍在 DOM（未卸载）', () => {
    render(<><TabNav /><WorkspaceRouter sidebarVisible={true} /></>);
    expect(screen.getByTestId('project-workspace')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /工具/ }));
    expect(screen.getByTestId('project-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('tools-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('progress-workspace')).toBeInTheDocument();
  });

  it('来回切换 tab 不触发 workspace 重新挂载', () => {
    render(<><TabNav /><WorkspaceRouter sidebarVisible={true} /></>);
    const projectBefore = screen.getByTestId('project-workspace');
    fireEvent.click(screen.getByRole('button', { name: /工具/ }));
    fireEvent.click(screen.getByRole('button', { name: /项目/ }));
    const projectAfter = screen.getByTestId('project-workspace');
    expect(projectBefore).toBe(projectAfter);
  });
});
