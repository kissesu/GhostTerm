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
import styles from '../atlas.module.css';

/**
 * 权限码 → 中文展示标签映射。
 *
 * 业务背景（用户需求 2026-04-30）：
 *   - 矩阵列头原始为 `resource:action` 英文 code（PROJECT READ / FEEDBACK CREATE 等），
 *     超管阅读成本高；按用户提供的对照表统一改中文。
 *   - 找不到 code 的 fallback：把 resource 部分按 RESOURCE_CN 译成中文 +
 *     action 部分按 ACTION_CN 译成中文，不再回落英文（避免中英混杂）。
 *   - 事件 E* 单独保留 "E1/E2..." 编号，避免事件 9 起步时翻译表碰壁。
 *   - `*:*` 通配权限统一译为"全部权限"。
 */
const PERMISSION_LABEL: Record<string, string> = {
  '*:*': '全部权限',
  'project:read': '项目查看',
  'project:create': '项目创建',
  'project:update': '项目编辑',
  'feedback:read': '反馈查看',
  'feedback:create': '反馈记录',
  'payment:read': '收款查看',
  'payment:create': '收款录入',
  'file:read': '文件查看',
  'file:upload': '文件上传',
};

/** resource → 中文 fallback（用户表外的 resource 也能展示中文） */
const RESOURCE_CN: Record<string, string> = {
  '*': '全部',
  project: '项目',
  feedback: '反馈',
  payment: '收款',
  file: '文件',
  event: '事件',
  user: '用户',
  role: '角色',
};

/** action → 中文 fallback */
const ACTION_CN: Record<string, string> = {
  '*': '全部',
  read: '查看',
  create: '创建',
  update: '编辑',
  delete: '删除',
  upload: '上传',
};

/**
 * 把单条权限（resource/action）映射成展示文本。
 *
 * 业务规则：
 *   1. 优先精确匹配 PERMISSION_LABEL（用户对照表）
 *   2. event:E* → "事件 E*"（保留事件编号原值）
 *   3. fallback：RESOURCE_CN[resource] + ACTION_CN[action]；任一缺失退回原 code
 */
function formatPermissionLabel(resource: string, action: string): string {
  const code = `${resource}:${action}`;
  const exact = PERMISSION_LABEL[code];
  if (exact) return exact;
  // event:E1 / event:E2 ... 走单独路径
  if (resource === 'event' && /^E\d+$/.test(action)) {
    return `事件 ${action}`;
  }
  const r = RESOURCE_CN[resource];
  const a = ACTION_CN[action];
  if (r && a) return `${r}${a}`;
  return code;
}

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
                    <th key={p.id} title={`${p.resource}:${p.action}（${p.scope}）`}>
                      {/* 用户需求 2026-04-30：列头改中文展示，原始 code 保留在 title hover */}
                      <span style={{ color: 'var(--text)', fontWeight: 700 }}>
                        {formatPermissionLabel(p.resource, p.action)}
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
                    <td>
                      {role.name}
                      {role.isSystem && (
                        <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--faint)' }}>
                          系统
                        </span>
                      )}
                      {dirty && <span className={styles.dirtyBadge}>未保存</span>}
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
                            // 系统超管角色（id=1）一般使用 *:* 通配权限；矩阵编辑允许，但需谨慎
                            // 不禁用以保持纯粹的"矩阵 = 真实绑定"语义
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
                          disabled={!dirty}
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
