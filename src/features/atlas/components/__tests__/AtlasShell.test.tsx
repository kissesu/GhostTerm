/**
 * @file AtlasShell.test.tsx
 * @description AtlasShell 测试：导航切换三个 view。
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import AtlasShell from '../../AtlasShell';
import { useAtlasUsersStore } from '../../stores/atlasUsersStore';
import { useAtlasRolesStore } from '../../stores/atlasRolesStore';
import { useGlobalAuthStore } from '../../../../shared/stores/globalAuthStore';
import { useGlobalPermissionStore } from '../../../../shared/stores/globalPermissionStore';

const TEST_USER = {
  id: 1,
  username: 'admin',
  displayName: 'Admin',
  roleId: 1,
  isActive: true,
  createdAt: '2026-04-29T00:00:00Z',
  permissions: ['*:*'],
};

beforeEach(() => {
  useAtlasUsersStore.setState({
    users: [],
    loading: false,
    error: null,
    load: vi.fn().mockResolvedValue(undefined),
  });
  useAtlasRolesStore.setState({
    roles: [],
    permissions: [],
    rolePermissions: new Map(),
    rolePermissionsServer: new Map(),
    loading: false,
    error: null,
    load: vi.fn().mockResolvedValue(undefined),
  });
  useGlobalAuthStore.setState({
    accessToken: 'tok',
    refreshToken: 'rfk',
    user: TEST_USER,
    loading: false,
    error: null,
  });
  // Task 12：默认重置 permissionStore 为空（无 permissions:role:manage）
  // 避免上一个 case 残留污染下一个 case
  useGlobalPermissionStore.getState().reset();
});

describe('AtlasShell', () => {
  it('默认渲染用户管理 view', () => {
    render(<AtlasShell />);
    expect(screen.getByTestId('atlas-shell')).toBeInTheDocument();
    expect(screen.getByTestId('atlas-users-table')).toBeInTheDocument();
  });

  it('点击角色权限切换到矩阵 view', async () => {
    render(<AtlasShell />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('atlas-nav-roles'));
    // 用户管理仍 mounted（display:none），矩阵也 mounted
    expect(screen.getByTestId('atlas-roles-matrix')).toBeInTheDocument();
  });

  it('点击系统配置切换到 config view', async () => {
    render(<AtlasShell />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('atlas-nav-config'));
    expect(screen.getByTestId('atlas-system-config')).toBeInTheDocument();
  });

  it('Task 12：无 permissions:role:manage 权限时「权限管理」菜单项隐藏', () => {
    // permission store 已在 beforeEach reset 为空
    render(<AtlasShell />);
    expect(screen.queryByTestId('atlas-nav-permissions')).not.toBeInTheDocument();
  });

  it('Task 12：拥有 permissions:role:manage 时「权限管理」菜单项可见', () => {
    useGlobalPermissionStore.getState().hydrate(['permissions:role:manage']);
    render(<AtlasShell />);
    expect(screen.getByTestId('atlas-nav-permissions')).toBeInTheDocument();
  });

  it('Task 12：super_admin 通过 *:* 通配符自动获得「权限管理」菜单', () => {
    useGlobalPermissionStore.setState({ isSuperAdmin: true });
    render(<AtlasShell />);
    expect(screen.getByTestId('atlas-nav-permissions')).toBeInTheDocument();
  });
});
