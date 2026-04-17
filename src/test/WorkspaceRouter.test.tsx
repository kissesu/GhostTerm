/**
 * @file WorkspaceRouter.test.tsx
 * @description 验证 WorkspaceRouter 三 workspace 并列 + display 切换
 * @author Atlas.oi
 * @date 2026-04-17
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useTabStore } from '../shared/stores/tabStore';
import { WorkspaceRouter } from '../layouts/WorkspaceRouter';

// Mock ProjectWorkspace（避免它内部依赖 Tauri）
vi.mock('../layouts/ProjectWorkspace', () => ({
  ProjectWorkspace: () => <div data-testid="project-workspace">project</div>,
}));

describe('WorkspaceRouter', () => {
  beforeEach(() => {
    useTabStore.setState({ activeTab: 'project' });
  });

  it('三个 workspace 均挂载到 DOM', () => {
    render(<WorkspaceRouter sidebarVisible={true} />);
    expect(screen.getByTestId('project-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('tools-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('progress-workspace')).toBeInTheDocument();
  });

  it('默认激活 project，其它 display:none', () => {
    render(<WorkspaceRouter sidebarVisible={true} />);
    const project = screen.getByTestId('project-workspace').parentElement!;
    const tools = screen.getByTestId('tools-workspace').parentElement!;
    expect(project).toHaveStyle({ display: 'flex' });
    expect(tools).toHaveStyle({ display: 'none' });
  });

  it('切换到 tools 后 tools 显示，其它隐藏', () => {
    useTabStore.setState({ activeTab: 'tools' });
    render(<WorkspaceRouter sidebarVisible={true} />);
    const tools = screen.getByTestId('tools-workspace').parentElement!;
    const project = screen.getByTestId('project-workspace').parentElement!;
    expect(tools).toHaveStyle({ display: 'flex' });
    expect(project).toHaveStyle({ display: 'none' });
  });
});
