/**
 * @file RolePermissionMatrix.test.tsx
 * @description Task 10 单角色权限编辑面板的 6 项契约测试。
 *
 *              覆盖：
 *                1. FetchesAndRendersOnMount     —— 16 perms 全勾选场景
 *                2. TogglingMarksDirty            —— 取消一项 → dirty bar + save 启用
 *                3. SaveCallsClient               —— save 调 PUT 后再 GET 刷快照
 *                4. CancelRevertsLocalState       —— cancel 后状态归位 + dirty=false
 *                5. SuperAdminRoleReadonly        —— roleId=1 全只读 + 锁
 *                6. CheckboxesDisabledDuringSave  —— 保存途中 checkbox 全 disabled（race 修复验证）
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
  updateRolePermissions: vi.fn(),
}));

import { RolePermissionMatrix } from '../RolePermissionMatrix';
import {
  listAllPermissions,
  getRolePermissions,
  updateRolePermissions,
} from '../../api/permissions';

const mockedList = vi.mocked(listAllPermissions);
const mockedGet = vi.mocked(getRolePermissions);
const mockedUpdate = vi.mocked(updateRolePermissions);

/** 16 条权限：覆盖 4 个 resource group × 4 个 action 让 group 折叠也有意义 */
function buildCatalog() {
  const list = [];
  let id = 1;
  for (const resource of ['project', 'feedback', 'payment', 'file']) {
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

beforeEach(() => {
  mockedList.mockReset();
  mockedGet.mockReset();
  mockedUpdate.mockReset();
});

describe('RolePermissionMatrix', () => {
  it('FetchesAndRendersOnMount: 渲染所有 16 条权限并对 server grant 勾选', async () => {
    const catalog = buildCatalog();
    mockedList.mockResolvedValue(catalog);
    // role 2 拥有全部 16 个权限
    mockedGet.mockResolvedValue(catalog);

    render(<RolePermissionMatrix roleId={2} roleName="developer" />);

    // 等待加载完成
    await waitFor(() => {
      expect(screen.getByTestId('role-perm-matrix')).toBeInTheDocument();
      expect(screen.queryByText('加载中…')).not.toBeInTheDocument();
    });

    // 16 个 checkbox 全部存在
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(16);
    // 全部勾选
    boxes.forEach((box) => expect(box).toBeChecked());
  });

  it('TogglingMarksDirty: 取消一个勾选 → dirty bar 出现 + save 按钮可点击', async () => {
    const catalog = buildCatalog();
    mockedList.mockResolvedValue(catalog);
    mockedGet.mockResolvedValue(catalog);

    render(<RolePermissionMatrix roleId={2} roleName="developer" />);
    await waitFor(() => expect(screen.getByTestId('role-perm-matrix')).toBeInTheDocument());

    // 初始无 dirty bar
    expect(screen.queryByTestId('role-perm-dirty-bar')).not.toBeInTheDocument();

    const box = screen.getByTestId('role-perm-checkbox-1');
    const user = userEvent.setup();
    await user.click(box);

    // dirty bar 出现且 save 按钮可点击
    expect(screen.getByTestId('role-perm-dirty-bar')).toBeInTheDocument();
    expect(screen.getByTestId('role-perm-save')).not.toBeDisabled();
    expect(box).not.toBeChecked();
  });

  it('SaveCallsClient: 保存调 updateRolePermissions(roleId, ids[]) 后重拉 GET', async () => {
    const catalog = buildCatalog();
    mockedList.mockResolvedValue(catalog);
    // 初始 grant: [1, 2, 3]
    mockedGet
      .mockResolvedValueOnce(catalog.slice(0, 3))
      // 保存后重拉：grant: [2, 3, 4]（模拟用户取消 1 + 新增 4）
      .mockResolvedValueOnce(catalog.slice(1, 4));
    mockedUpdate.mockResolvedValue();

    render(<RolePermissionMatrix roleId={2} roleName="developer" />);
    await waitFor(() => expect(screen.getByTestId('role-perm-matrix')).toBeInTheDocument());

    const user = userEvent.setup();
    // 取消 id=1，勾选 id=4 → 期待 PUT 提交 [2,3,4]
    await user.click(screen.getByTestId('role-perm-checkbox-1'));
    await user.click(screen.getByTestId('role-perm-checkbox-4'));

    await user.click(screen.getByTestId('role-perm-save'));

    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledTimes(1);
    });
    const [calledRoleId, calledIds] = mockedUpdate.mock.calls[0];
    expect(calledRoleId).toBe(2);
    expect([...calledIds].sort((a, b) => a - b)).toEqual([2, 3, 4]);

    // 重拉 GET（一次 mount + 一次保存后）
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));

    // 保存后 dirty 消失
    await waitFor(() =>
      expect(screen.queryByTestId('role-perm-dirty-bar')).not.toBeInTheDocument(),
    );
  });

  it('CancelRevertsLocalState: 取消勾选后点 cancel → 状态复原 + dirty=false', async () => {
    const catalog = buildCatalog();
    mockedList.mockResolvedValue(catalog);
    mockedGet.mockResolvedValue(catalog);

    render(<RolePermissionMatrix roleId={2} roleName="developer" />);
    await waitFor(() => expect(screen.getByTestId('role-perm-matrix')).toBeInTheDocument());

    const user = userEvent.setup();
    const box = screen.getByTestId('role-perm-checkbox-1');
    await user.click(box);
    expect(box).not.toBeChecked();
    expect(screen.getByTestId('role-perm-dirty-bar')).toBeInTheDocument();

    await user.click(screen.getByTestId('role-perm-cancel'));

    // 取消后回到服务端状态：勾选 + dirty bar 消失
    expect(box).toBeChecked();
    expect(screen.queryByTestId('role-perm-dirty-bar')).not.toBeInTheDocument();
  });

  it('SuperAdminRoleReadonly: roleId=1 时所有 checkbox 禁用 + 锁标记可见', async () => {
    const catalog = buildCatalog();
    mockedList.mockResolvedValue(catalog);
    // super_admin 通常持有 *:* 哨兵 grant；此处 mock 返回完整 catalog 验证 UI 锁
    mockedGet.mockResolvedValue(catalog);

    render(<RolePermissionMatrix roleId={1} roleName="super_admin" />);
    await waitFor(() => expect(screen.getByTestId('role-perm-matrix')).toBeInTheDocument());

    // 锁徽标可见
    expect(screen.getByTestId('role-perm-superadmin-lock')).toBeInTheDocument();

    // 所有 checkbox 禁用
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.length).toBeGreaterThan(0);
    boxes.forEach((box) => expect(box).toBeDisabled());

    // 即使取消勾选也不会进入 dirty 状态
    const user = userEvent.setup();
    await user.click(boxes[0]);
    expect(screen.queryByTestId('role-perm-dirty-bar')).not.toBeInTheDocument();
  });

  it('CheckboxesDisabledDuringSave: 保存途中所有 checkbox 携带 disabled 属性', async () => {
    const catalog = buildCatalog();
    mockedList.mockResolvedValue(catalog);
    mockedGet.mockResolvedValueOnce(catalog.slice(0, 3));

    // updateRolePermissions 返回的 promise 由测试控制 resolve 时机，
    // 让"保存中"窗口暴露给断言
    let resolveUpdate: () => void = () => {};
    mockedUpdate.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    mockedGet.mockResolvedValueOnce(catalog.slice(0, 3));

    render(<RolePermissionMatrix roleId={2} roleName="developer" />);
    await waitFor(() => expect(screen.getByTestId('role-perm-matrix')).toBeInTheDocument());

    const user = userEvent.setup();
    // 触发 dirty
    await user.click(screen.getByTestId('role-perm-checkbox-1'));
    expect(screen.getByTestId('role-perm-save')).not.toBeDisabled();

    // 点保存 —— PUT 还未 resolve，进入"保存中"
    await user.click(screen.getByTestId('role-perm-save'));

    // 关键断言：所有 checkbox 都 disabled（race fix 验证）
    await waitFor(() => {
      const boxes = screen.getAllByRole('checkbox');
      boxes.forEach((box) => expect(box).toBeDisabled());
    });
    // save 按钮也 disabled
    expect(screen.getByTestId('role-perm-save')).toBeDisabled();

    // 释放 PUT，让 component 完成保存流程
    resolveUpdate();
    await waitFor(() => {
      expect(screen.queryByTestId('role-perm-dirty-bar')).not.toBeInTheDocument();
    });
  });
});
