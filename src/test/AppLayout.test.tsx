/**
 * @file AppLayout.test.tsx - AppLayout 骨架测试
 * @description 验证三栏面板能正常渲染（PBI-0 验收要求）。
 *              PBI-3 后：侧边栏占位被替换为真实 Sidebar 组件，测试更新为验证 Sidebar 存在。
 *              Stage 2.5 后：AppLayout 渲染真实特性模块，测试中 mock 掉特性组件（只测布局）。
 * @author Atlas.oi
 * @date 2026-04-12
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import AppLayout from '../layouts/AppLayout';
import { useSidebarStore } from '../features/sidebar';
import { useFileTreeStore } from '../features/sidebar';
import { useProjectStore } from '../features/sidebar';
import { DEFAULT_TERMINAL_SETTINGS, useSettingsStore } from '../shared/stores/settingsStore';
import { useTerminalStore } from '../features/terminal';

// AppLayout 测试只验证布局行为，Terminal 组件 mock 为轻量占位
// 避免 xterm.js 依赖浏览器 API（WebGL）在 jsdom 中报错
// 使用 importOriginal 保留真实 useTerminalStore，仅替换 Terminal 组件
vi.mock('../features/terminal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/terminal')>();
  return {
    ...actual,
    Terminal: ({ projectPath }: { projectPath: string }) => (
      <div data-testid={`terminal-panel-${projectPath}`}>终端</div>
    ),
  };
});
vi.mock('../features/editor', () => ({
  Editor: () => <div data-testid="editor-panel">编辑器</div>,
  EditorTabs: () => <div data-testid="editor-tabs" />,
}));

beforeEach(() => {
  useSidebarStore.setState({ activeTab: 'files', visible: true });
  useFileTreeStore.setState({ tree: [], expandedPaths: new Set() });
  useProjectStore.setState({ currentProject: null, recentProjects: [] });
  useSettingsStore.setState({ appView: 'main', terminal: DEFAULT_TERMINAL_SETTINGS });
  useTerminalStore.setState({ sessions: {}, activeProjectPath: null });
  // 启动恢复 effect 会调用 list_recent_projects_cmd
  vi.mocked(invoke).mockResolvedValue([]);
});

describe('AppLayout', () => {
  it('渲染三个面板占位符', () => {
    render(<AppLayout />);
    // PBI-3 后：左侧面板为真实 Sidebar 组件（包含项目选择器）
    // 无项目时终端面板显示"打开项目后启动终端"占位文案
    expect(screen.getByTestId('sidebar-root')).toBeInTheDocument();
    expect(screen.getByText(/编辑器/)).toBeInTheDocument();
    expect(screen.getByText('打开项目后启动终端')).toBeInTheDocument();
    expect(screen.getByTestId('open-settings-button')).toBeInTheDocument();
  });

  it('切换项目时不销毁旧 Terminal 实例', async () => {
    useTerminalStore.setState({
      sessions: {
        '/proj-a': { ptyId: 'pty-a', wsPort: 9001, wsToken: 'tok-a', connected: true },
        '/proj-b': { ptyId: 'pty-b', wsPort: 9002, wsToken: 'tok-b', connected: true },
      },
      activeProjectPath: '/proj-b',
    });
    useProjectStore.setState({
      currentProject: { name: 'proj-b', path: '/proj-b', last_opened: 0 },
      recentProjects: [],
    });

    render(<AppLayout />);

    // 两个项目的 terminal 包裹 div 均存在（不销毁）
    const containers = document.querySelectorAll('[data-testid^="terminal-wrapper-"]');
    expect(containers).toHaveLength(2);
  });

  it('活跃项目无 session 时显示"启动终端"按钮而非空白', () => {
    useTerminalStore.setState({ sessions: {}, activeProjectPath: null });
    useProjectStore.setState({
      currentProject: { name: 'proj-a', path: '/proj-a', last_opened: 0 },
      recentProjects: [],
    });

    render(<AppLayout />);

    expect(screen.getByRole('button', { name: '启动终端' })).toBeInTheDocument();
  });
});
