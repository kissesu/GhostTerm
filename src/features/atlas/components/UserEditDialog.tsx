/**
 * @file UserEditDialog.tsx
 * @description 用户创建 / 编辑对话框（Atlas 用户管理）。
 *
 *              工作模式：
 *                - mode='create'：所有字段为空；提交时调 store.createUser
 *                - mode='edit'：用 user 预填；提交时调 store.updateUser
 *                  （密码留空 = 不改密码）
 *
 *              字段：username / password / displayName / roleId / isActive
 *
 *              roles 来自 atlasRolesStore；调用方需保证已 load。
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { useMemo, useState, type FormEvent } from 'react';

import type { UserPayload } from '../../progress/api/schemas';
import { useAtlasUsersStore } from '../stores/atlasUsersStore';
import { useAtlasRolesStore } from '../stores/atlasRolesStore';
import styles from '../atlas.module.css';

/**
 * super_admin 角色 ID，与后端 services.SuperAdminRoleID = 1 对齐。
 * 业务规则 2026-05-03：超级管理员角色不允许通过此对话框新建/转授，
 * 因此 select 选项需过滤掉 id=1；编辑现有 super_admin 用户时整个 select 锁定为只读。
 */
const SUPER_ADMIN_ROLE_ID = 1;

interface UserEditDialogProps {
  mode: 'create' | 'edit';
  user?: UserPayload | null;
  onClose: () => void;
}

export function UserEditDialog({ mode, user, onClose }: UserEditDialogProps) {
  const [username, setUsername] = useState(user?.username ?? '');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [roleId, setRoleId] = useState<number>(user?.roleId ?? 2);
  const [isActive, setIsActive] = useState<boolean>(user?.isActive ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roles = useAtlasRolesStore((s) => s.roles);
  const createUser = useAtlasUsersStore((s) => s.createUser);
  const updateUser = useAtlasUsersStore((s) => s.updateUser);

  // 是否在编辑超级管理员（编辑模式 + 用户原本即为 super_admin）
  // 该场景下 select 必须只读，禁止通过此对话框转授/降权 super_admin
  const isEditingSuperAdmin = mode === 'edit' && user?.roleId === SUPER_ADMIN_ROLE_ID;

  // 可选角色列表：始终过滤掉 super_admin
  // 编辑非超管用户与新建用户时，下拉框均不出现"超级管理员"选项
  const selectableRoles = useMemo(
    () => roles.filter((r) => r.id !== SUPER_ADMIN_ROLE_ID),
    [roles],
  );

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'create') {
        await createUser({
          username: username.trim(),
          password,
          displayName: displayName.trim() || undefined,
          roleId,
        });
      } else if (user) {
        await updateUser(user.id, {
          username: username.trim() !== user.username ? username.trim() : undefined,
          password: password.length > 0 ? password : undefined,
          displayName: displayName !== user.displayName ? displayName : undefined,
          roleId: roleId !== user.roleId ? roleId : undefined,
          isActive: isActive !== user.isActive ? isActive : undefined,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.dialogBackdrop} data-testid="user-edit-dialog-backdrop" onClick={onClose}>
      <form
        className={styles.dialog}
        data-testid="user-edit-dialog"
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className={styles.dialogTitle}>{mode === 'create' ? '创建用户' : '编辑用户'}</h3>

        <label className={styles.label}>
          用户名
          <input
            className={styles.input}
            type="text"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            data-testid="user-edit-username"
          />
        </label>

        <label className={styles.label}>
          {mode === 'create' ? '密码' : '密码（留空 = 不修改）'}
          <input
            className={styles.input}
            type="password"
            required={mode === 'create'}
            minLength={mode === 'create' ? 6 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="user-edit-password"
            autoComplete="new-password"
          />
        </label>

        <label className={styles.label}>
          显示名（缺省=用户名）
          <input
            className={styles.input}
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            data-testid="user-edit-display-name"
          />
        </label>

        <label className={styles.label}>
          角色
          {isEditingSuperAdmin ? (
            // 编辑超级管理员：select 只读化，避免通过此对话框降权或转授
            // 视觉上仍保持与其它 select 一致（同 className），仅以 disabled 拒交互
            <select
              className={styles.select}
              value={SUPER_ADMIN_ROLE_ID}
              disabled
              data-testid="user-edit-role"
              aria-readonly="true"
            >
              <option value={SUPER_ADMIN_ROLE_ID}>超级管理员（不可改）</option>
            </select>
          ) : (
            <select
              className={styles.select}
              value={roleId}
              onChange={(e) => setRoleId(Number(e.target.value))}
              data-testid="user-edit-role"
            >
              {selectableRoles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
        </label>

        {mode === 'edit' && (
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              data-testid="user-edit-active"
            />
            激活账号（取消勾选 = 禁用并强制下线）
          </label>
        )}

        {error && (
          <div className={styles.errorBox} data-testid="user-edit-error">
            {error}
          </div>
        )}

        <div className={styles.dialogFooter}>
          <button
            type="button"
            className={styles.btnGhost}
            onClick={onClose}
            disabled={submitting}
            data-testid="user-edit-cancel"
          >
            取消
          </button>
          <button
            type="submit"
            className={styles.btnPrimary}
            disabled={submitting}
            data-testid="user-edit-submit"
          >
            {submitting ? '提交中…' : mode === 'create' ? '创建' : '保存'}
          </button>
        </div>
      </form>
    </div>
  );
}
