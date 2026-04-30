/**
 * @file UsersTable.tsx
 * @description 用户列表页（Atlas 用户管理主视图）。
 *
 *              功能：
 *                - 进入 view 时调用 store.load() 拉用户列表
 *                - 渲染表格：ID / 用户名 / 显示名 / 角色 / 激活 / 创建时间 / 操作
 *                - 顶部按钮：新建用户
 *                - 每行操作：编辑 / 删除（带确认）
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { useEffect, useState } from 'react';

import type { UserPayload } from '../../progress/api/schemas';
import { useAtlasUsersStore } from '../stores/atlasUsersStore';
import { useAtlasRolesStore } from '../stores/atlasRolesStore';
import { useGlobalAuthStore } from '../../../shared/stores/globalAuthStore';
import { UserEditDialog } from './UserEditDialog';
import styles from '../atlas.module.css';

export function UsersTable() {
  const users = useAtlasUsersStore((s) => s.users);
  const loading = useAtlasUsersStore((s) => s.loading);
  const error = useAtlasUsersStore((s) => s.error);
  const load = useAtlasUsersStore((s) => s.load);
  const deleteUser = useAtlasUsersStore((s) => s.deleteUser);

  const roles = useAtlasRolesStore((s) => s.roles);
  const loadRoles = useAtlasRolesStore((s) => s.load);

  const currentUser = useGlobalAuthStore((s) => s.user);

  const [editing, setEditing] = useState<UserPayload | null>(null);
  const [creating, setCreating] = useState(false);

  // 首次挂载并发拉用户 + 角色（两者独立 store，UserEditDialog 需要 roles 渲染下拉框）
  useEffect(() => {
    void load();
    if (roles.length === 0) {
      void loadRoles();
    }
  }, [load, loadRoles, roles.length]);

  const roleName = (rid: number): string => {
    return roles.find((r) => r.id === rid)?.name ?? `role:${rid}`;
  };

  const handleDelete = async (u: UserPayload) => {
    if (!window.confirm(`确认删除用户 ${u.username}？\n（软删除：账号将被禁用并强制下线）`)) {
      return;
    }
    try {
      await deleteUser(u.id);
    } catch (err) {
      window.alert(`删除失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div data-testid="atlas-users-table">
      <div className={styles.pageHeader}>
        <div>
          <h2 className={styles.pageTitle}>用户管理</h2>
          <p className={styles.pageSubtitle}>创建、编辑、禁用系统用户。</p>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={() => setCreating(true)}
            data-testid="atlas-create-user"
          >
            新建用户
          </button>
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>ID</th>
              <th>用户名</th>
              <th>显示名</th>
              <th>角色</th>
              <th>状态</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && users.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)' }}>
                  加载中…
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)' }}>
                  暂无用户
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} data-testid={`atlas-user-row-${u.id}`}>
                  <td>{u.id}</td>
                  <td>{u.username}</td>
                  <td>{u.displayName}</td>
                  <td>
                    <span className={`${styles.tag} ${u.roleId === 1 ? styles.tagAdmin : ''}`}>
                      {roleName(u.roleId)}
                    </span>
                  </td>
                  <td>
                    {u.isActive ? (
                      <span className={`${styles.tag} ${styles.tagActive}`}>启用</span>
                    ) : (
                      <span className={`${styles.tag} ${styles.tagInactive}`}>禁用</span>
                    )}
                  </td>
                  <td style={{ color: 'var(--muted)' }}>{u.createdAt.slice(0, 10)}</td>
                  <td>
                    <div className={styles.actionCol}>
                      <button
                        type="button"
                        className={styles.btnGhost}
                        onClick={() => setEditing(u)}
                        data-testid={`atlas-edit-user-${u.id}`}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className={styles.btnDanger}
                        onClick={() => void handleDelete(u)}
                        // 防自删：不允许删除当前登录用户
                        disabled={currentUser?.id === u.id}
                        title={currentUser?.id === u.id ? '不能删除当前登录用户' : '删除用户'}
                        data-testid={`atlas-delete-user-${u.id}`}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {creating && (
        <UserEditDialog
          mode="create"
          onClose={() => setCreating(false)}
        />
      )}
      {editing && (
        // 用 key 让切换被编辑对象时 dialog 重挂，draft 不残留旧用户数据
        <UserEditDialog
          key={editing.id}
          mode="edit"
          user={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
