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
import AppLayout from '../layouts/AppLayout';
import { useSidebarStore } from '../features/sidebar';
import { useFileTreeStore } from '../features/sidebar';
import { useProjectStore } from '../features/sidebar';

// AppLayout 测试只验证布局行为，特性组件 mock 为轻量占位
// 避免 xterm.js/CodeMirror 依赖浏览器 API（matchMedia/WebGL）在 jsdom 中报错
vi.mock('../features/terminal', () => ({
  Terminal: () => <div data-testid="terminal-panel">终端</div>,
}));
vi.mock('../features/editor', () => ({
  Editor: () => <div data-testid="editor-panel">编辑器</div>,
  EditorTabs: () => <div data-testid="editor-tabs" />,
}));

beforeEach(() => {
  useSidebarStore.setState({ activeTab: 'files', visible: true });
  useFileTreeStore.setState({ tree: [], expandedPaths: new Set() });
  useProjectStore.setState({ currentProject: null, recentProjects: [] });
});

describe('AppLayout', () => {
  it('渲染三个面板占位符', () => {
    render(<AppLayout />);
    // PBI-3 后：左侧面板为真实 Sidebar 组件（包含项目选择器）
    // 中间和右侧仍为占位
    expect(screen.getByTestId('sidebar-root')).toBeInTheDocument();
    expect(screen.getByText(/编辑器/)).toBeInTheDocument();
    expect(screen.getByText(/终端/)).toBeInTheDocument();
  });
});
