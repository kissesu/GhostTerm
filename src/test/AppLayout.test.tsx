/**
 * @file AppLayout.test.tsx - AppLayout 骨架测试
 * @description 验证三栏面板能正常渲染（PBI-0 验收要求）
 * @author Atlas.oi
 * @date 2026-04-12
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AppLayout from '../layouts/AppLayout';

describe('AppLayout', () => {
  it('渲染三个面板占位符', () => {
    render(<AppLayout />);
    // 验证三个面板占位文字存在
    expect(screen.getByText(/侧边栏/)).toBeInTheDocument();
    expect(screen.getByText(/编辑器/)).toBeInTheDocument();
    expect(screen.getByText(/终端/)).toBeInTheDocument();
  });
});
