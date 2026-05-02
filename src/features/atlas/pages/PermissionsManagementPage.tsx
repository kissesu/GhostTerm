/**
 * @file PermissionsManagementPage.tsx
 * @description Atlas 「权限管理」子页（Task 12）。
 *
 *              组合 Task 10 RolePermissionMatrix + Task 11 UserPermissionOverridePanel：
 *                - 子 tab 1「角色权限」：role 下拉 + RolePermissionMatrix
 *                - 子 tab 2「用户 override」：user 下拉 + UserPermissionOverridePanel
 *
 *              下拉选项来源：
 *                - role  ← useAtlasRolesStore.roles
 *                - user  ← useAtlasUsersStore.users
 *
 *              super_admin 处理（决策对齐 Task 10/11）：
 *                - super_admin role（id=1）和 super_admin 用户（roleId=1）
 *                  在下拉中保留可见但 disabled，并在标签后追加「(超管不可编辑)」
 *                - 默认选择跳过 super_admin —— 选第一个非超管 role/user，
 *                  避免用户进入页面就看到只读面板困惑
 *
 *              数据加载：
 *                - mount 时调 atlasRolesStore.load() + atlasUsersStore.load()
 *                  这两个 store 是 idempotent 的（重复 load 仅多发一次请求），
 *                  与 RolesPermissionMatrix / UsersTable 既有调用并存无副作用
 *
 *              不引入路由：
 *                - 子 tab 切换用 useState + display:none，与 AtlasShell 风格一致
 *                - 切 tab 时保留各 tab 内部组件 mount 状态（避免重新拉网络）
 *
 * @author Atlas.oi
 * @date 2026-05-02
 */

import { useEffect, useState } from 'react';

import { RolePermissionMatrix } from '../components/RolePermissionMatrix';
import { UserPermissionOverridePanel } from '../components/UserPermissionOverridePanel';
import { useAtlasUsersStore } from '../stores/atlasUsersStore';
import { useAtlasRolesStore } from '../stores/atlasRolesStore';
import styles from '../atlas.module.css';

/** super_admin role ID 与后端 services.SuperAdminRoleID = 1 对齐 */
const SUPER_ADMIN_ROLE_ID = 1;

type PermPageTab = 'roles' | 'users';

export function PermissionsManagementPage() {
  // 子 tab 选择
  const [tab, setTab] = useState<PermPageTab>('roles');

  // store 数据
  const roles = useAtlasRolesStore((s) => s.roles);
  const loadRoles = useAtlasRolesStore((s) => s.load);
  const users = useAtlasUsersStore((s) => s.users);
  const loadUsers = useAtlasUsersStore((s) => s.load);

  // 当前选中的 role / user id（默认 null，等数据回来后选第一个非超管）
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  // ============================================
  // 第一步：mount 时拉双 store
  // ============================================
  useEffect(() => {
    void loadRoles();
    void loadUsers();
  }, [loadRoles, loadUsers]);

  // ============================================
  // 第二步：默认选择 —— 跳过 super_admin
  // 业务背景：用户首次进入页面看到的应是"可编辑"状态，避免看到锁图标困惑
  // ============================================
  useEffect(() => {
    if (selectedRoleId === null && roles.length > 0) {
      const first = roles.find((r) => r.id !== SUPER_ADMIN_ROLE_ID) ?? roles[0];
      setSelectedRoleId(first?.id ?? null);
    }
  }, [roles, selectedRoleId]);

  useEffect(() => {
    if (selectedUserId === null && users.length > 0) {
      const first = users.find((u) => u.roleId !== SUPER_ADMIN_ROLE_ID) ?? users[0];
      setSelectedUserId(first?.id ?? null);
    }
  }, [users, selectedUserId]);

  // 当前选中的 role 对象（取 name 传给 RolePermissionMatrix 头部展示用）
  const selectedRole = roles.find((r) => r.id === selectedRoleId);

  return (
    <div data-testid="permissions-management-page">
      {/* 页面头部 */}
      <div className={styles.pageHeader}>
        <div>
          <h2 className={styles.pageTitle}>权限管理</h2>
          <p className={styles.pageSubtitle}>
            按角色批量分配，或为单个用户做 override 微调
          </p>
        </div>
      </div>

      {/* 子 tab 切换条 */}
      <div
        className={styles.permPageTabs}
        role="tablist"
        aria-label="权限管理子页"
        data-testid="perm-page-tabs"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'roles'}
          className={`${styles.permPageTab} ${tab === 'roles' ? styles.permPageTabActive : ''}`}
          onClick={() => setTab('roles')}
          data-testid="perm-page-tab-roles"
        >
          角色权限
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'users'}
          className={`${styles.permPageTab} ${tab === 'users' ? styles.permPageTabActive : ''}`}
          onClick={() => setTab('users')}
          data-testid="perm-page-tab-users"
        >
          用户 override
        </button>
      </div>

      {/* tab 1：角色权限 —— 用 display:none 切换保留内部 state，避免切回时重拉 */}
      <div
        style={{ display: tab === 'roles' ? 'block' : 'none' }}
        data-testid="perm-page-panel-roles"
      >
        <div className={styles.permPickerBar}>
          <label className={styles.permPickerLabel} htmlFor="perm-role-picker">
            选择角色
          </label>
          <select
            id="perm-role-picker"
            className={styles.permPickerSelect}
            value={selectedRoleId ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              setSelectedRoleId(v === '' ? null : Number(v));
            }}
            data-testid="perm-page-role-select"
          >
            {roles.length === 0 && <option value="">加载中…</option>}
            {roles.map((r) => (
              <option
                key={r.id}
                value={r.id}
                disabled={r.id === SUPER_ADMIN_ROLE_ID}
                data-testid={`perm-page-role-option-${r.id}`}
              >
                {r.name}
                {r.id === SUPER_ADMIN_ROLE_ID ? ' (超管不可编辑)' : ''}
              </option>
            ))}
          </select>
        </div>
        {selectedRoleId !== null && (
          <RolePermissionMatrix
            // key 让切换 role 时强制 remount，避免内部 useState 残留
            key={selectedRoleId}
            roleId={selectedRoleId}
            roleName={selectedRole?.name}
          />
        )}
      </div>

      {/* tab 2：用户 override */}
      <div
        style={{ display: tab === 'users' ? 'block' : 'none' }}
        data-testid="perm-page-panel-users"
      >
        <div className={styles.permPickerBar}>
          <label className={styles.permPickerLabel} htmlFor="perm-user-picker">
            选择用户
          </label>
          <select
            id="perm-user-picker"
            className={styles.permPickerSelect}
            value={selectedUserId ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              setSelectedUserId(v === '' ? null : Number(v));
            }}
            data-testid="perm-page-user-select"
          >
            {users.length === 0 && <option value="">加载中…</option>}
            {users.map((u) => (
              <option
                key={u.id}
                value={u.id}
                disabled={u.roleId === SUPER_ADMIN_ROLE_ID}
                data-testid={`perm-page-user-option-${u.id}`}
              >
                {u.displayName || u.username}
                {u.roleId === SUPER_ADMIN_ROLE_ID ? ' (超管不可编辑)' : ''}
              </option>
            ))}
          </select>
        </div>
        {selectedUserId !== null && (
          <UserPermissionOverridePanel
            key={selectedUserId}
            userId={selectedUserId}
          />
        )}
      </div>
    </div>
  );
}
