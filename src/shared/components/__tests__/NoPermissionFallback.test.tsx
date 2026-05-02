/**
 * @file NoPermissionFallback.test.tsx
 * @description NoPermissionFallback 渲染 + 退出按钮联通验证。
 *
 * @author Atlas.oi
 * @date 2026-05-02
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// 全局认证 store mock：仅暴露 logout（被组件 selector 订阅）
const mockLogout = vi.fn(async () => {});
vi.mock('../../stores/globalAuthStore', () => ({
  useGlobalAuthStore: (selector: (s: { logout: typeof mockLogout }) => unknown) =>
    selector({ logout: mockLogout }),
}));

import NoPermissionFallback from '../NoPermissionFallback';

beforeEach(() => {
  mockLogout.mockClear();
});

describe('NoPermissionFallback', () => {
  it('渲染标题 + 副文案 + 退出按钮 + ShieldOff 图标容器', () => {
    render(<NoPermissionFallback />);
    // 标题文案
    expect(screen.getByText('无任何模块访问权限')).toBeInTheDocument();
    // 副文案
    expect(screen.getByText(/请联系管理员开通/)).toBeInTheDocument();
    // 退出按钮
    expect(screen.getByTestId('no-permission-logout')).toBeInTheDocument();
    // role/aria 设置
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('点击退出按钮触发 globalAuthStore.logout', () => {
    render(<NoPermissionFallback />);
    fireEvent.click(screen.getByTestId('no-permission-logout'));
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});
