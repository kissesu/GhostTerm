/**
 * @file RolesPermissionMatrix.tsx
 * @description 角色 × 权限二维矩阵勾选编辑（Atlas RBAC 管理）。
 *
 *              纵向：角色（1 行 / role）
 *              横向：权限（1 列 / permission，按 resource 分组）
 *              单元格：checkbox（已绑定 = 勾选）
 *
 *              工作流：
 *                1. 进入 view 时 store.load() 并发拉 roles + permissions + 各 role 已绑定权限
 *                2. 用户切换勾选 → store.togglePermission（仅本地编辑态）
 *                3. 行末"保存"按钮 → store.saveRolePermissions(roleId)
 *                4. 行末"重置"按钮 → store.resetRoleEdits(roleId) 复原服务端快照
 *                5. dirty 状态由 store.isDirty(roleId) 实时计算
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { useEffect, useMemo, useState } from 'react';

import { useAtlasRolesStore } from '../stores/atlasRolesStore';
import { formatPermissionLabel as formatPermissionLabelFull } from '../utils/permissionLabels';
import styles from '../atlas.module.css';

/**
 * 权限码 → 中文展示标签：统一走 utils/permissionLabels.ts 的 formatPermissionLabel(3 段)
 * （commit 7f238bc 之后；旧本地 PERMISSION_LABEL/RESOURCE_CN/ACTION_CN 2 段表已下线）
 */

export function RolesPermissionMatrix() {
  const roles = useAtlasRolesStore((s) => s.roles);
  const permissions = useAtlasRolesStore((s) => s.permissions);
  const rolePermissions = useAtlasRolesStore((s) => s.rolePermissions);
  const loading = useAtlasRolesStore((s) => s.loading);
  const error = useAtlasRolesStore((s) => s.error);
  const load = useAtlasRolesStore((s) => s.load);
  const togglePermission = useAtlasRolesStore((s) => s.togglePermission);
  const isDirty = useAtlasRolesStore((s) => s.isDirty);
  const saveRolePermissions = useAtlasRolesStore((s) => s.saveRolePermissions);
  const resetRoleEdits = useAtlasRolesStore((s) => s.resetRoleEdits);

  const [savingRoleId, setSavingRoleId] = useState<number | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  // 按 resource 分组权限以让横向 header 更可读
  const groupedPermissions = useMemo(() => {
    const groups = new Map<string, typeof permissions>();
    for (const p of permissions) {
      const arr = groups.get(p.resource) ?? [];
      arr.push(p);
      groups.set(p.resource, arr);
    }
    return Array.from(groups.entries()).map(([resource, items]) => ({ resource, items }));
  }, [permissions]);

  const handleSave = async (roleId: number) => {
    setSavingRoleId(roleId);
    try {
      await saveRolePermissions(roleId);
    } catch (err) {
      window.alert(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingRoleId(null);
    }
  };

  return (
    <div data-testid="atlas-roles-matrix">
      <div className={styles.pageHeader}>
        <div>
          <h2 className={styles.pageTitle}>角色权限</h2>
          <p className={styles.pageSubtitle}>
            勾选每行修改角色权限；超管（admin）拥有 *:* 通配权限，无需逐项配置。
          </p>
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      {loading && roles.length === 0 ? (
        <div style={{ color: 'var(--muted)', padding: 24 }}>加载中…</div>
      ) : (
        <div className={styles.matrixWrap}>
          <table className={styles.matrix}>
            <thead>
              <tr>
                <th>角色</th>
                {groupedPermissions.map((g) =>
                  g.items.map((p) => (
                    <th
                      key={p.id}
                      title={`${p.resource}:${p.action}:${p.scope}`}
                    >
                      {/* 用户需求 2026-05-02：列头完整 3 段中文（含 scope）；原始英文 code 留在 title hover 供调试 */}
                      <span style={{ color: 'var(--text)', fontWeight: 700 }}>
                        {formatPermissionLabelFull(p.resource, p.action, p.scope)}
                      </span>
                    </th>
                  )),
                )}
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => {
                const dirty = isDirty(role.id);
                const set = rolePermissions.get(role.id) ?? new Set<number>();
                return (
                  <tr key={role.id} data-testid={`atlas-role-row-${role.id}`}>
                    <td className={styles.roleNameCell}>
                      <span className={styles.roleNameText}>{role.name}</span>
                      {role.isSystem && (
                        <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--faint)' }}>
                          系统
                        </span>
                      )}
                      {dirty && (
                        <span
                          className={styles.dirtyBadge}
                          aria-label="未保存"
                          title="未保存的修改"
                        >
                          未保存
                        </span>
                      )}
                    </td>
                    {groupedPermissions.map((g) =>
                      g.items.map((p) => (
                        <td key={p.id}>
                          <input
                            type="checkbox"
                            className={styles.matrixCheckbox}
                            checked={set.has(p.id)}
                            onChange={() => togglePermission(role.id, p.id)}
                            data-testid={`atlas-perm-${role.id}-${p.id}`}
                            // Task 7 review Important #1（race condition 修复）：
                            // 保存进行中禁止编辑该 row 的所有勾选；否则 PUT 提交后 GET 重拉
                            // 会用服务端结果覆盖本地刚改的格子，造成"用户的修改静默丢失"。
                            // 仅 disable 当前正在保存的 role 行；其它角色行可继续编辑。
                            disabled={savingRoleId === role.id}
                          />
                        </td>
                      )),
                    )}
                    <td>
                      <div className={styles.actionCol}>
                        <button
                          type="button"
                          className={styles.btnPrimary}
                          disabled={!dirty || savingRoleId === role.id}
                          onClick={() => void handleSave(role.id)}
                          data-testid={`atlas-save-role-${role.id}`}
                        >
                          {savingRoleId === role.id ? '保存中…' : '保存'}
                        </button>
                        <button
                          type="button"
                          className={styles.btnGhost}
                          // race fix：保存中禁止重置（重置 + 保存竞态会导致数据态不可预期）
                          disabled={!dirty || savingRoleId === role.id}
                          onClick={() => resetRoleEdits(role.id)}
                          data-testid={`atlas-reset-role-${role.id}`}
                        >
                          重置
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
