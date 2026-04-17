/**
 * @file TabNav.test.tsx
 * @description TabNav 点击切换 activeTab + 激活样式测试
 * @author Atlas.oi
 * @date 2026-04-17
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useTabStore } from '../shared/stores/tabStore';
import { TabNav } from '../shared/components/TabNav';

describe('TabNav', () => {
  beforeEach(() => {
    useTabStore.setState({ activeTab: 'project' });
  });

  it('渲染三个 tab 按钮', () => {
    render(<TabNav />);
    expect(screen.getByRole('button', { name: /项目/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /工具/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /进度/ })).toBeInTheDocument();
  });

  it('点击"工具"切换 activeTab', () => {
    render(<TabNav />);
    fireEvent.click(screen.getByRole('button', { name: /工具/ }));
    expect(useTabStore.getState().activeTab).toBe('tools');
  });

  it('激活 tab 有 data-active="true" 属性', () => {
    render(<TabNav />);
    expect(screen.getByRole('button', { name: /项目/ })).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('button', { name: /工具/ })).toHaveAttribute('data-active', 'false');
  });
});
