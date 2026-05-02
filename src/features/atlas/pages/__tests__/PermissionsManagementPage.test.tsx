/**
 * @file PermissionsManagementPage.test.tsx
 * @description Task 12 PermissionsManagementPage 契约测试。
 *
 *              覆盖：
 *                1. RendersTabsAndDefaultsToRoles    —— 默认渲染两个 tab，角色 tab 激活
 *                2. SwitchTabRendersUserPanel        —— 切到 users tab，UserPermissionOverridePanel mounted
 *                3. RoleDropdownDisablesSuperAdmin   —— super_admin role 选项 disabled
 *                4. UserDropdownDisablesSuperAdmin   —— super_admin user 选项 disabled
 *                5. SelectedRoleChangesMatrix        —— 切换 role dropdown，子组件 remount with new roleId
 *                6. DefaultSelectionSkipsSuperAdmin  —— 默认选中第一个非超管 role/user
 *
 *              策略：mock 子组件 RolePermissionMatrix + UserPermissionOverridePanel
 *              只验证父组件 dropdown / tab / 默认选择逻辑，不重复测子组件内部行为
 *
 * @author Atlas.oi
 * @date 2026-05-02
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// mock 子组件：仅渲染一个含 props 的占位 div，让父组件测试聚焦于编排逻辑
vi.mock('../../components/RolePermissionMatrix', () => ({
  RolePermissionMatrix: (props: { roleId: number; roleName?: string }) => (
    <div
      data-testid="mock-role-perm-matrix"
      data-role-id={props.roleId}
      data-role-name={props.roleName ?? ''}
    >
      RolePermissionMatrix(roleId={props.roleId})
    </div>
  ),
}));

vi.mock('../../components/UserPermissionOverridePanel', () => ({
  UserPermissionOverridePanel: (props: { userId: number }) => (
    <div data-testid="mock-user-perm-override" data-user-id={props.userId}>
      UserPermissionOverridePanel(userId={props.userId})
    </div>
  ),
}));

import { PermissionsManagementPage } from '../PermissionsManagementPage';
import { useAtlasUsersStore } from '../../stores/atlasUsersStore';
import { useAtlasRolesStore } from '../../stores/atlasRolesStore';

const ROLE_SUPER_ADMIN = {
  id: 1,
  name: 'super_admin',
  description: null,
  isSystem: true,
  createdAt: '2026-04-29T00:00:00Z',
};

const ROLE_DEVELOPER = {
  id: 2,
  name: 'developer',
  description: null,
  isSystem: false,
  createdAt: '2026-04-29T00:00:00Z',
};

const ROLE_DESIGNER = {
  id: 3,
  name: 'designer',
  description: null,
  isSystem: false,
  createdAt: '2026-04-29T00:00:00Z',
};

const USER_ADMIN = {
  id: 1,
  username: 'admin',
  displayName: 'Admin',
  roleId: 1,
  isActive: true,
  createdAt: '2026-04-29T00:00:00Z',
  permissions: ['*:*'],
};

const USER_ZHANGSAN = {
  id: 42,
  username: 'zhangsan',
  displayName: '张三',
  roleId: 2,
  isActive: true,
  createdAt: '2026-04-29T00:00:00Z',
  permissions: [],
};

const USER_LISI = {
  id: 43,
  username: 'lisi',
  displayName: '李四',
  roleId: 3,
  isActive: true,
  createdAt: '2026-04-29T00:00:00Z',
  permissions: [],
};

beforeEach(() => {
  // 父组件会调 store.load()；此处 mock 成 no-op，不去网络
  useAtlasRolesStore.setState({
    roles: [ROLE_SUPER_ADMIN, ROLE_DEVELOPER, ROLE_DESIGNER],
    permissions: [],
    rolePermissions: new Map(),
    rolePermissionsServer: new Map(),
    loading: false,
    error: null,
    load: vi.fn().mockResolvedValue(undefined),
  });
  useAtlasUsersStore.setState({
    users: [USER_ADMIN, USER_ZHANGSAN, USER_LISI],
    loading: false,
    error: null,
    load: vi.fn().mockResolvedValue(undefined),
  });
});

describe('PermissionsManagementPage', () => {
  it('RendersTabsAndDefaultsToRoles: 默认渲染两个 tab 按钮，roles tab 激活', async () => {
    render(<PermissionsManagementPage />);

    expect(screen.getByTestId('permissions-management-page')).toBeInTheDocument();
    // 两个 tab 都渲染
    const rolesTab = screen.getByTestId('perm-page-tab-roles');
    const usersTab = screen.getByTestId('perm-page-tab-users');
    expect(rolesTab).toBeInTheDocument();
    expect(usersTab).toBeInTheDocument();
    // roles tab 激活
    expect(rolesTab).toHaveAttribute('aria-selected', 'true');
    expect(usersTab).toHaveAttribute('aria-selected', 'false');

    // 默认选中第一个非超管 role (developer id=2)，子组件渲染
    await waitFor(() => {
      const matrix = screen.getByTestId('mock-role-perm-matrix');
      expect(matrix).toHaveAttribute('data-role-id', '2');
      expect(matrix).toHaveAttribute('data-role-name', 'developer');
    });
  });

  it('SwitchTabRendersUserPanel: 点击用户 override tab → UserPermissionOverridePanel mounted', async () => {
    render(<PermissionsManagementPage />);
    const user = userEvent.setup();

    // 等默认 user 选中
    await waitFor(() => {
      expect(screen.getByTestId('mock-user-perm-override')).toBeInTheDocument();
    });

    // 切到 users tab
    await user.click(screen.getByTestId('perm-page-tab-users'));
    expect(screen.getByTestId('perm-page-tab-users')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('perm-page-tab-roles')).toHaveAttribute('aria-selected', 'false');

    // 子组件已渲染（无论 display 状态，display:none 不影响 testid 查询）
    const overridePanel = screen.getByTestId('mock-user-perm-override');
    expect(overridePanel).toBeInTheDocument();
    // 默认选第一个非超管 user：zhangsan id=42
    expect(overridePanel).toHaveAttribute('data-user-id', '42');
  });

  it('RoleDropdownDisablesSuperAdmin: super_admin 角色选项 disabled + 标签含「(超管不可编辑)」', () => {
    render(<PermissionsManagementPage />);

    const opt = screen.getByTestId('perm-page-role-option-1') as HTMLOptionElement;
    expect(opt).toBeDisabled();
    expect(opt.textContent).toContain('super_admin');
    expect(opt.textContent).toContain('超管不可编辑');

    // 非超管 role 不 disabled
    const dev = screen.getByTestId('perm-page-role-option-2') as HTMLOptionElement;
    expect(dev).not.toBeDisabled();
  });

  it('UserDropdownDisablesSuperAdmin: super_admin 用户（roleId=1）选项 disabled', async () => {
    render(<PermissionsManagementPage />);
    const user = userEvent.setup();

    // 切到 users tab 让 select 渲染（虽然 display:none 也仍 mounted，但以契约方式切过去更直观）
    await user.click(screen.getByTestId('perm-page-tab-users'));

    const adminOpt = screen.getByTestId('perm-page-user-option-1') as HTMLOptionElement;
    expect(adminOpt).toBeDisabled();
    expect(adminOpt.textContent).toContain('Admin');
    expect(adminOpt.textContent).toContain('超管不可编辑');

    const zhangsanOpt = screen.getByTestId('perm-page-user-option-42') as HTMLOptionElement;
    expect(zhangsanOpt).not.toBeDisabled();

    const lisiOpt = screen.getByTestId('perm-page-user-option-43') as HTMLOptionElement;
    expect(lisiOpt).not.toBeDisabled();
  });

  it('SelectedRoleChangesMatrix: 切换 role dropdown → 子组件 remount with new roleId', async () => {
    render(<PermissionsManagementPage />);
    const user = userEvent.setup();

    // 默认 developer (id=2)
    await waitFor(() => {
      expect(screen.getByTestId('mock-role-perm-matrix')).toHaveAttribute('data-role-id', '2');
    });

    // 切到 designer (id=3)
    const select = screen.getByTestId('perm-page-role-select') as HTMLSelectElement;
    await user.selectOptions(select, '3');

    await waitFor(() => {
      expect(screen.getByTestId('mock-role-perm-matrix')).toHaveAttribute('data-role-id', '3');
      expect(screen.getByTestId('mock-role-perm-matrix')).toHaveAttribute(
        'data-role-name',
        'designer',
      );
    });
  });

  it('DefaultSelectionSkipsSuperAdmin: 默认选第一个非超管 role/user', async () => {
    render(<PermissionsManagementPage />);

    await waitFor(() => {
      // role 默认 developer (id=2) 而非 super_admin (id=1)
      expect(screen.getByTestId('mock-role-perm-matrix')).toHaveAttribute('data-role-id', '2');
      // user 默认 zhangsan (id=42) 而非 admin (id=1, roleId=1)
      expect(screen.getByTestId('mock-user-perm-override')).toHaveAttribute('data-user-id', '42');
    });
  });
});
