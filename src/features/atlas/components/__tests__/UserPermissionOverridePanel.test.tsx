/**
 * @file UserPermissionOverridePanel.test.tsx
 * @description Task 11 单用户 override 三态编辑面板的 7 项契约测试。
 *
 *              覆盖：
 *                1. FetchesAllSourcesOnMount       —— 4 路 fetch 完成后渲染表格
 *                2. InheritIsDefaultWhenNoOverride —— 空 overrides → 全部 inherit
 *                3. ChipClickChangesLocalState     —— + grant 切换 + dirty bar 出现
 *                4. SaveSendsOnlyNonInheritEntries —— PUT body 不含 inherit 行
 *                5. CancelRevertsToServerState     —— cancel 后 chips 复位
 *                6. SuperAdminUserReadonly         —— roleId=1 全只读 + 锁
 *                7. ChipsDisabledDuringSave        —— race fix 验证（controlled promise）
 *
 * @author Atlas.oi
 * @date 2026-05-02
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../api/permissions', () => ({
  listAllPermissions: vi.fn(),
  getRolePermissions: vi.fn(),
  getUserPermissionOverrides: vi.fn(),
  updateUserPermissionOverrides: vi.fn(),
}));

import { UserPermissionOverridePanel } from '../UserPermissionOverridePanel';
import {
  listAllPermissions,
  getRolePermissions,
  getUserPermissionOverrides,
  updateUserPermissionOverrides,
} from '../../api/permissions';
import { useAtlasUsersStore } from '../../stores/atlasUsersStore';
import { useAtlasRolesStore } from '../../stores/atlasRolesStore';

const mockedList = vi.mocked(listAllPermissions);
const mockedRolePerms = vi.mocked(getRolePermissions);
const mockedGetOverrides = vi.mocked(getUserPermissionOverrides);
const mockedUpdate = vi.mocked(updateUserPermissionOverrides);

/** 8 条权限：覆盖 2 个 resource × 4 个 action 让排序也能验 */
function buildCatalog() {
  const list = [];
  let id = 1;
  for (const resource of ['project', 'feedback']) {
    for (const action of ['read', 'create', 'update', 'delete']) {
      list.push({
        id,
        resource,
        action,
        scope: 'all',
        code: `${resource}:${action}:all`,
      });
      id++;
    }
  }
  return list;
}

const TEST_USER = {
  id: 42,
  username: 'zhangsan',
  displayName: '张三',
  roleId: 2,
  isActive: true,
  createdAt: '2026-04-29T00:00:00Z',
  permissions: [],
};

const SUPER_ADMIN_USER = {
  id: 1,
  username: 'admin',
  displayName: 'Admin',
  roleId: 1,
  isActive: true,
  createdAt: '2026-04-29T00:00:00Z',
  permissions: ['*:*'],
};

const TEST_ROLE = {
  id: 2,
  name: 'developer',
  description: null,
  isSystem: false,
  createdAt: '2026-04-29T00:00:00Z',
};

beforeEach(() => {
  mockedList.mockReset();
  mockedRolePerms.mockReset();
  mockedGetOverrides.mockReset();
  mockedUpdate.mockReset();
  // 重置 stores 至已 load 状态（调用方契约：父组件先 load）
  useAtlasUsersStore.setState({
    users: [TEST_USER, SUPER_ADMIN_USER],
    loading: false,
    error: null,
  });
  useAtlasRolesStore.setState({
    roles: [TEST_ROLE, { ...TEST_ROLE, id: 1, name: 'super_admin', isSystem: true }],
    permissions: [],
    rolePermissions: new Map(),
    rolePermissionsServer: new Map(),
    loading: false,
    error: null,
  });
});

describe('UserPermissionOverridePanel', () => {
  it('FetchesAllSourcesOnMount: 渲染 8 条 perm 行 + role 基线列正确', async () => {
    const catalog = buildCatalog();
    mockedList.mockResolvedValue(catalog);
    // role 基线：拥有前 4 条（project 全套）
    mockedRolePerms.mockResolvedValue(catalog.slice(0, 4));
    mockedGetOverrides.mockResolvedValue([]);

    render(<UserPermissionOverridePanel userId={42} />);

    await waitFor(() => {
      expect(screen.getByTestId('user-perm-override')).toBeInTheDocument();
      expect(screen.queryByText('加载中…')).not.toBeInTheDocument();
    });

    // 8 行全部渲染
    for (let id = 1; id <= 8; id++) {
      expect(screen.getByTestId(`user-perm-row-${id}`)).toBeInTheDocument();
    }
    // role 基线：1-4 显示 ✓，5-8 显示 —
    for (let id = 1; id <= 4; id++) {
      expect(screen.getByTestId(`user-perm-role-base-${id}`)).toHaveTextContent('✓');
    }
    for (let id = 5; id <= 8; id++) {
      expect(screen.getByTestId(`user-perm-role-base-${id}`)).toHaveTextContent('—');
    }

    // 4 路 fetch 都被调
    expect(mockedList).toHaveBeenCalledTimes(1);
    expect(mockedRolePerms).toHaveBeenCalledWith(2);
    expect(mockedGetOverrides).toHaveBeenCalledWith(42);
  });

  it('InheritIsDefaultWhenNoOverride: 空 overrides → 所有行 inherit chip 激活', async () => {
    const catalog = buildCatalog();
    mockedList.mockResolvedValue(catalog);
    mockedRolePerms.mockResolvedValue([]);
    mockedGetOverrides.mockResolvedValue([]);

    render(<UserPermissionOverridePanel userId={42} />);
    await waitFor(() => expect(screen.getByTestId('user-perm-override')).toBeInTheDocument());

    // 所有 inherit chip 都应 aria-checked=true，grant/deny 应 false
    for (let id = 1; id <= 8; id++) {
      expect(screen.getByTestId(`user-perm-chip-inherit-${id}`)).toHaveAttribute(
        'aria-checked',
        'true',
      );
      expect(screen.getByTestId(`user-perm-chip-grant-${id}`)).toHaveAttribute(
        'aria-checked',
        'false',
      );
      expect(screen.getByTestId(`user-perm-chip-deny-${id}`)).toHaveAttribute(
        'aria-checked',
        'false',
      );
    }

    // 无 dirty bar
    expect(screen.queryByTestId('user-perm-dirty-bar')).not.toBeInTheDocument();
  });

  it('ChipClickChangesLocalState: 点 + grant → 该行 grant 激活 + dirty bar 出现', async () => {
    const catalog = buildCatalog();
    mockedList.mockResolvedValue(catalog);
    mockedRolePerms.mockResolvedValue([]);
    mockedGetOverrides.mockResolvedValue([]);

    render(<UserPermissionOverridePanel userId={42} />);
    await waitFor(() => expect(screen.getByTestId('user-perm-override')).toBeInTheDocument());

    expect(screen.queryByTestId('user-perm-dirty-bar')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByTestId('user-perm-chip-grant-3'));

    // row 3 grant 激活，inherit 失活
    expect(screen.getByTestId('user-perm-chip-grant-3')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('user-perm-chip-inherit-3')).toHaveAttribute('aria-checked', 'false');

    // dirty bar 出现 + save 按钮可点击
    expect(screen.getByTestId('user-perm-dirty-bar')).toBeInTheDocument();
    expect(screen.getByTestId('user-perm-save')).not.toBeDisabled();
  });

  it('SaveSendsOnlyNonInheritEntries: PUT body 仅含 grant + deny 行（不含 6 条 inherit）', async () => {
    const catalog = buildCatalog();
    mockedList.mockResolvedValue(catalog);
    mockedRolePerms.mockResolvedValue([]);
    mockedGetOverrides.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { permissionId: 2, effect: 'grant' },
      { permissionId: 5, effect: 'deny' },
    ]);
    mockedUpdate.mockResolvedValue();

    render(<UserPermissionOverridePanel userId={42} />);
    await waitFor(() => expect(screen.getByTestId('user-perm-override')).toBeInTheDocument());

    const user = userEvent.setup();
    // 设 1 个 grant + 1 个 deny；其它 6 条留 inherit
    await user.click(screen.getByTestId('user-perm-chip-grant-2'));
    await user.click(screen.getByTestId('user-perm-chip-deny-5'));

    await user.click(screen.getByTestId('user-perm-save'));

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1));
    const [calledUserId, calledOverrides] = mockedUpdate.mock.calls[0];
    expect(calledUserId).toBe(42);
    // 仅 2 条（不是 8 条）—— inherit 行不应被发送
    expect(calledOverrides).toHaveLength(2);
    expect(calledOverrides).toEqual(
      expect.arrayContaining([
        { permissionId: 2, effect: 'grant' },
        { permissionId: 5, effect: 'deny' },
      ]),
    );

    // 重拉 GET（一次 mount + 一次保存后）
    await waitFor(() => expect(mockedGetOverrides).toHaveBeenCalledTimes(2));
    // dirty 消失
    await waitFor(() =>
      expect(screen.queryByTestId('user-perm-dirty-bar')).not.toBeInTheDocument(),
    );
  });

  it('CancelRevertsToServerState: cancel 后 chips 复位 + dirty=false', async () => {
    const catalog = buildCatalog();
    mockedList.mockResolvedValue(catalog);
    mockedRolePerms.mockResolvedValue([]);
    // 服务端初始：perm 2 = grant
    mockedGetOverrides.mockResolvedValue([{ permissionId: 2, effect: 'grant' }]);

    render(<UserPermissionOverridePanel userId={42} />);
    await waitFor(() => expect(screen.getByTestId('user-perm-override')).toBeInTheDocument());

    // 初始 row 2 = grant
    expect(screen.getByTestId('user-perm-chip-grant-2')).toHaveAttribute('aria-checked', 'true');

    const user = userEvent.setup();
    // 改成 deny → dirty
    await user.click(screen.getByTestId('user-perm-chip-deny-2'));
    expect(screen.getByTestId('user-perm-chip-deny-2')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('user-perm-dirty-bar')).toBeInTheDocument();

    // 点 cancel
    await user.click(screen.getByTestId('user-perm-cancel'));

    // 复位回服务端 grant
    expect(screen.getByTestId('user-perm-chip-grant-2')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('user-perm-chip-deny-2')).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByTestId('user-perm-dirty-bar')).not.toBeInTheDocument();
  });

  it('SuperAdminUserReadonly: userId=1 (role_id=1) 全 chip disabled + 锁可见 + 无 save', async () => {
    const catalog = buildCatalog();
    mockedList.mockResolvedValue(catalog);
    mockedRolePerms.mockResolvedValue(catalog);
    mockedGetOverrides.mockResolvedValue([]);

    render(<UserPermissionOverridePanel userId={1} />);
    await waitFor(() => expect(screen.getByTestId('user-perm-override')).toBeInTheDocument());

    // 锁徽标可见
    expect(screen.getByTestId('user-perm-superadmin-lock')).toBeInTheDocument();

    // 全部 chip disabled
    for (let id = 1; id <= 8; id++) {
      expect(screen.getByTestId(`user-perm-chip-inherit-${id}`)).toBeDisabled();
      expect(screen.getByTestId(`user-perm-chip-grant-${id}`)).toBeDisabled();
      expect(screen.getByTestId(`user-perm-chip-deny-${id}`)).toBeDisabled();
    }

    // 即使点击也不会进入 dirty
    const user = userEvent.setup();
    await user.click(screen.getByTestId('user-perm-chip-grant-1'));
    expect(screen.queryByTestId('user-perm-dirty-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('user-perm-save')).not.toBeInTheDocument();
  });

  it('ChipsDisabledDuringSave: 保存途中所有 chip 携带 disabled（race fix 验证）', async () => {
    const catalog = buildCatalog();
    mockedList.mockResolvedValue(catalog);
    mockedRolePerms.mockResolvedValue([]);
    mockedGetOverrides.mockResolvedValueOnce([]);

    // updateUserPermissionOverrides 返回的 promise 由测试控制 resolve 时机
    let resolveUpdate: () => void = () => {};
    mockedUpdate.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    // 第二次 GET（保存后重拉）—— 即便 resolve 也不会立刻被消费
    mockedGetOverrides.mockResolvedValueOnce([{ permissionId: 1, effect: 'grant' }]);

    render(<UserPermissionOverridePanel userId={42} />);
    await waitFor(() => expect(screen.getByTestId('user-perm-override')).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByTestId('user-perm-chip-grant-1'));
    expect(screen.getByTestId('user-perm-save')).not.toBeDisabled();

    // 触发保存，PUT 还未 resolve → 进入"保存中"
    await user.click(screen.getByTestId('user-perm-save'));

    // 关键断言：所有 chip 都 disabled
    await waitFor(() => {
      for (let id = 1; id <= 8; id++) {
        expect(screen.getByTestId(`user-perm-chip-inherit-${id}`)).toBeDisabled();
        expect(screen.getByTestId(`user-perm-chip-grant-${id}`)).toBeDisabled();
        expect(screen.getByTestId(`user-perm-chip-deny-${id}`)).toBeDisabled();
      }
    });
    expect(screen.getByTestId('user-perm-save')).toBeDisabled();

    // 释放 PUT
    resolveUpdate();
    await waitFor(() => {
      expect(screen.queryByTestId('user-perm-dirty-bar')).not.toBeInTheDocument();
    });
  });
});
