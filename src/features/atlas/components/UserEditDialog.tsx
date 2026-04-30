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

import { useState, type FormEvent } from 'react';

import type { UserPayload } from '../../progress/api/schemas';
import { useAtlasUsersStore } from '../stores/atlasUsersStore';
import { useAtlasRolesStore } from '../stores/atlasRolesStore';
import styles from '../atlas.module.css';

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
          <select
            className={styles.select}
            value={roleId}
            onChange={(e) => setRoleId(Number(e.target.value))}
            data-testid="user-edit-role"
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
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
