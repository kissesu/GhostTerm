/**
 * @file AppLayout.test.tsx - AppLayout 骨架测试
 * @description 验证三栏面板能正常渲染（PBI-0 验收要求）。
 *              PBI-3 后：侧边栏占位被替换为真实 Sidebar 组件，测试更新为验证 Sidebar 存在。
 * @author Atlas.oi
 * @date 2026-04-12
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import AppLayout from '../layouts/AppLayout';
import { useSidebarStore } from '../features/sidebar';
import { useFileTreeStore } from '../features/sidebar';
import { useProjectStore } from '../features/sidebar';

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
