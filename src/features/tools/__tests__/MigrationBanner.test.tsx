/**
 * @file MigrationBanner.test.tsx
 * @description MigrationBanner 组件测试：
 *   1. pendingMigrationCount=0 时不渲染
 *   2. count > 0 时渲染含数量的提示文本 + 按钮
 *   3. 点击"知道了"调用 acknowledgeMigration（count 清零）
 * @author Atlas.oi
 * @date 2026-04-18
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Tauri invoke（TemplateStore 内部依赖） ───
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// ─── Mock sidecarInvoke ───
vi.mock('../toolsSidecarClient', () => ({
  sidecarInvoke: vi.fn(),
}));

import { useTemplateStore } from '../templates/TemplateStore';
import { MigrationBanner } from '../templates/MigrationBanner';

// 每个 test 前重置 store
beforeEach(() => {
  useTemplateStore.setState({ templates: [], loading: false, pendingMigrationCount: 0 });
});

describe('MigrationBanner', () => {
  it('pendingMigrationCount=0 时不渲染任何内容', () => {
    const { container } = render(<MigrationBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('count > 0 时渲染含数量的文字和知道了按钮', () => {
    useTemplateStore.setState({ pendingMigrationCount: 3 });
    render(<MigrationBanner />);

    // 确认文字中含数量
    expect(screen.getByTestId('migration-banner')).toBeDefined();
    expect(screen.getByText(/3 条新规则/)).toBeDefined();
    expect(screen.getByRole('button', { name: '知道了' })).toBeDefined();
  });

  it('点击知道了后 pendingMigrationCount 清零', () => {
    useTemplateStore.setState({ pendingMigrationCount: 2 });
    render(<MigrationBanner />);

    fireEvent.click(screen.getByRole('button', { name: '知道了' }));

    expect(useTemplateStore.getState().pendingMigrationCount).toBe(0);
  });
});
