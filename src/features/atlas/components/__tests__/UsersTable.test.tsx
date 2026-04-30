/**
 * @file UsersTable.test.tsx
 * @description Atlas UsersTable 组件测试：
 *               - 加载用户列表渲染表格行
 *               - 创建用户按钮打开对话框
 *               - 删除按钮触发 store.deleteUser（用 confirm spy）
 *               - 自删保护：当前用户的删除按钮 disabled
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { UsersTable } from '../UsersTable';
import { useAtlasUsersStore } from '../../stores/atlasUsersStore';
import { useAtlasRolesStore } from '../../stores/atlasRolesStore';
import { useGlobalAuthStore } from '../../../../shared/stores/globalAuthStore';

const TEST_USER = {
  id: 1,
  username: 'admin',
  displayName: 'Admin',
  roleId: 1,
  isActive: true,
  createdAt: '2026-04-29T00:00:00Z',
  permissions: ['*:*'],
};

const ALICE = {
  id: 2,
  username: 'alice',
  displayName: 'Alice',
  roleId: 2,
  isActive: true,
  createdAt: '2026-04-29T00:00:00Z',
  permissions: [] as string[],
};

beforeEach(() => {
  useAtlasUsersStore.setState({
    users: [],
    loading: false,
    error: null,
    load: vi.fn().mockResolvedValue(undefined),
    deleteUser: vi.fn().mockResolvedValue(undefined),
  });
  useAtlasRolesStore.setState({
    roles: [
      { id: 1, name: 'admin', isSystem: true, createdAt: '2026-04-29T00:00:00Z' },
      { id: 2, name: 'developer', isSystem: true, createdAt: '2026-04-29T00:00:00Z' },
    ],
    load: vi.fn().mockResolvedValue(undefined),
  });
  useGlobalAuthStore.setState({
    accessToken: 'tok',
    refreshToken: 'rfk',
    user: TEST_USER,
    loading: false,
    error: null,
  });
});

describe('UsersTable', () => {
  it('挂载时调用 store.load', () => {
    const loadSpy = vi.fn().mockResolvedValue(undefined);
    useAtlasUsersStore.setState({ ...useAtlasUsersStore.getState(), load: loadSpy });
    render(<UsersTable />);
    expect(loadSpy).toHaveBeenCalled();
  });

  it('渲染用户列表行', () => {
    useAtlasUsersStore.setState({
      ...useAtlasUsersStore.getState(),
      users: [TEST_USER, ALICE],
    });
    render(<UsersTable />);
    const row1 = screen.getByTestId('atlas-user-row-1');
    const row2 = screen.getByTestId('atlas-user-row-2');
    expect(row1).toBeInTheDocument();
    expect(row2).toBeInTheDocument();
    // 在各自行内查找用户名，避免 'admin' 同时命中角色 tag 文本
    expect(row1.textContent).toContain('admin');
    expect(row2.textContent).toContain('alice');
  });

  it('当前用户的删除按钮被 disable（防自删）', () => {
    useAtlasUsersStore.setState({
      ...useAtlasUsersStore.getState(),
      users: [TEST_USER, ALICE],
    });
    render(<UsersTable />);
    expect(screen.getByTestId('atlas-delete-user-1')).toBeDisabled();
    expect(screen.getByTestId('atlas-delete-user-2')).not.toBeDisabled();
  });

  it('点击新建按钮弹出 dialog', async () => {
    render(<UsersTable />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('atlas-create-user'));
    expect(screen.getByTestId('user-edit-dialog')).toBeInTheDocument();
  });

  it('确认删除时调用 store.deleteUser', async () => {
    const deleteSpy = vi.fn().mockResolvedValue(undefined);
    useAtlasUsersStore.setState({
      ...useAtlasUsersStore.getState(),
      users: [TEST_USER, ALICE],
      deleteUser: deleteSpy,
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<UsersTable />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('atlas-delete-user-2'));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(2));
  });

  it('取消删除（confirm 返回 false）不调用 deleteUser', async () => {
    const deleteSpy = vi.fn().mockResolvedValue(undefined);
    useAtlasUsersStore.setState({
      ...useAtlasUsersStore.getState(),
      users: [TEST_USER, ALICE],
      deleteUser: deleteSpy,
    });
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<UsersTable />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('atlas-delete-user-2'));

    expect(deleteSpy).not.toHaveBeenCalled();
  });
});
