/**
 * @file RolePermissionMatrix.tsx
 * @description 单角色权限编辑面板（Task 10：与 RolesPermissionMatrix 互补的"聚焦视图"）。
 *
 *              与 RolesPermissionMatrix（行 = 角色 / 列 = 权限的宽矩阵）的差异：
 *                - 本组件由父组件传入单个 roleId，仅负责该 role 的 grant/revoke
 *                - 资源按 group 折叠（nav / progress / users / permissions 等），支持收起展开
 *                - 顶部 sticky 条展示"未保存修改"+ 取消/保存按钮（与 prompt 设计稿一致）
 *                - super_admin（id=1）整面板只读 + 锁图标 + tooltip：UI 显式拒绝编辑，
 *                  与后端 SuperAdminInvariants middleware 的 422 互为防御
 *
 *              工作流：
 *                1. mount 时并发 listAllPermissions() + getRolePermissions(roleId) 拉双数据
 *                2. 用户勾选 → 本地 Set 切换 → 与服务端快照 diff 算 dirty
 *                3. 保存 → updateRolePermissions(PUT) → 重新 getRolePermissions 刷快照
 *                4. 取消 → 本地 Set 复位为服务端快照
 *                5. Task 7 race fix（Important #1）：保存进行中所有 checkbox + 按钮均 disabled，
 *                   避免"用户在保存途中又改格子，PUT 之后 GET 重拉将其覆盖"的竞态
 *
 *              与 globalPermissionStore（Task 9）解耦：
 *                - 写后只 invalidate 自身 fetch，不直接调 globalPermissionStore.refresh()
 *                - 真实的"自己改自己角色权限 → 立即生效"由后端 token_version + apiFetch 401
 *                  silent refresh 自然驱动；本组件不抢这条职责
 *
 * @author Atlas.oi
 * @date 2026-05-02
 */

import { useEffect, useMemo, useState } from 'react';
import { Lock, ChevronDown, ChevronRight } from 'lucide-react';

import {
  listAllPermissions,
  getRolePermissions,
  updateRolePermissions,
  type PermissionDTO,
} from '../api/permissions';
import styles from '../atlas.module.css';

/** super_admin 角色 ID 与后端 services.SuperAdminRoleID = 1 对齐 */
const SUPER_ADMIN_ROLE_ID = 1;

interface RolePermissionMatrixProps {
  /** 目标角色 ID；调用方负责传入 super_admin（id=1）时本组件呈只读 */
  roleId: number;
  /** 角色显示名（顶部展示用，可选；不传时仅显示 ID） */
  roleName?: string;
  /** 保存成功回调，父组件可借此触发 toast / 自身刷新 */
  onSaved?: () => void;
}

/**
 * 资源分组中文名表（业务语义优先，code 仅作 fallback）。
 *
 * 业务背景：与 RolesPermissionMatrix 的 RESOURCE_CN 同源；这里独立维护一份是因为
 * 本组件对资源组做了"分组折叠"语义，覆盖范围比矩阵列头更广，需要包含 Task 6 之后
 * 新增的 nav / users / permissions 等"管理类"资源。
 */
const RESOURCE_CN: Record<string, string> = {
  '*': '全部资源',
  project: '项目',
  feedback: '反馈',
  payment: '收款',
  file: '文件',
  event: '事件',
  user: '用户',
  role: '角色',
  permissions: '权限管理',
  nav: '导航 Tab',
  progress: '进度模块',
  users: '用户管理',
};

const ACTION_CN: Record<string, string> = {
  '*': '全部',
  read: '查看',
  create: '创建',
  update: '编辑',
  delete: '删除',
  upload: '上传',
  manage: '管理',
  access: '访问',
};

/** 把 (resource, action) 映射成中文展示文本；找不到时回落英文 code */
function formatActionLabel(resource: string, action: string): string {
  // event:E1 / E2... 单独路径（业务事件编号保留）
  if (resource === 'event' && /^E\d+$/.test(action)) {
    return `事件 ${action}`;
  }
  return ACTION_CN[action] ?? action;
}

function formatResourceLabel(resource: string): string {
  return RESOURCE_CN[resource] ?? resource;
}

/** 设置工具：克隆 + 相等比较 */
function cloneSet<T>(s: Set<T>): Set<T> {
  return new Set(s);
}

function setEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

export function RolePermissionMatrix({ roleId, roleName, onSaved }: RolePermissionMatrixProps) {
  const isSuperAdmin = roleId === SUPER_ADMIN_ROLE_ID;

  const [allPerms, setAllPerms] = useState<PermissionDTO[]>([]);
  const [serverIds, setServerIds] = useState<Set<number>>(new Set());
  const [localIds, setLocalIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // 展开/折叠的资源组；默认全展开（Set 内的 resource 表示"已折叠"）
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // ============================================
  // 第一步：mount 时并发拉双数据
  // ============================================
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([listAllPermissions(), getRolePermissions(roleId)])
      .then(([catalog, granted]) => {
        if (cancelled) return;
        setAllPerms(catalog);
        const ids = new Set(granted.map((p) => p.id));
        setServerIds(ids);
        setLocalIds(cloneSet(ids));
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [roleId]);

  // ============================================
  // 第二步：按 resource 分组排序
  // ============================================
  const groups = useMemo(() => {
    const map = new Map<string, PermissionDTO[]>();
    for (const p of allPerms) {
      const arr = map.get(p.resource) ?? [];
      arr.push(p);
      map.set(p.resource, arr);
    }
    // 业务排序：固定优先级 -> 字母兜底；让 progress / users 等高频组靠前
    const order = ['progress', 'project', 'feedback', 'payment', 'file', 'event', 'users', 'permissions', 'nav', 'role', 'user', '*'];
    const entries = Array.from(map.entries());
    entries.sort(([a], [b]) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    return entries.map(([resource, items]) => ({ resource, items }));
  }, [allPerms]);

  // ============================================
  // 第三步：dirty 检测
  // ============================================
  const dirty = !isSuperAdmin && !setEqual(localIds, serverIds);

  // ============================================
  // 行为：toggle / save / cancel / collapse
  // ============================================
  const handleToggle = (permId: number) => {
    if (isSuperAdmin || saving) return;
    const next = cloneSet(localIds);
    if (next.has(permId)) {
      next.delete(permId);
    } else {
      next.add(permId);
    }
    setLocalIds(next);
  };

  const handleSave = async () => {
    if (isSuperAdmin || saving || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const ids = Array.from(localIds);
      await updateRolePermissions(roleId, ids);
      // 写后 GET 拉一次最新值刷快照（捕获其它管理员中间写入）
      const fresh = await getRolePermissions(roleId);
      const freshIds = new Set(fresh.map((p) => p.id));
      setServerIds(freshIds);
      // race fix：保存途中已禁用 checkbox，本地态 == 提交态 == 服务端态
      // 这里直接用 freshIds 覆盖 localIds 是安全的（无 in-flight 用户编辑）
      setLocalIds(cloneSet(freshIds));
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (saving) return;
    setLocalIds(cloneSet(serverIds));
  };

  const toggleCollapse = (resource: string) => {
    const next = cloneSet(collapsed);
    if (next.has(resource)) {
      next.delete(resource);
    } else {
      next.add(resource);
    }
    setCollapsed(next);
  };

  // ============================================
  // 渲染
  // ============================================
  if (loading) {
    return (
      <div data-testid="role-perm-matrix" style={{ color: 'var(--muted)', padding: 24 }}>
        加载中…
      </div>
    );
  }

  return (
    <div data-testid="role-perm-matrix">
      {/* 头部：role 名 + 锁标记 */}
      <div className={styles.permRoleHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={styles.permRoleHeaderLabel}>当前角色</span>
          <span style={{ fontSize: 13, fontWeight: 700 }}>
            {roleName ?? `Role #${roleId}`}
          </span>
        </div>
        {isSuperAdmin && (
          <span
            className={styles.permLockBadge}
            data-testid="role-perm-superadmin-lock"
            title="超管角色由系统强制只读，禁止通过 UI 修改"
          >
            <Lock size={11} aria-hidden="true" />
            只读
          </span>
        )}
      </div>

      {error && (
        <div className={styles.errorBox} data-testid="role-perm-error" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      {/* sticky 未保存修改条 */}
      {dirty && (
        <div className={styles.permDirtyBar} data-testid="role-perm-dirty-bar">
          <span>存在未保存修改</span>
          <div className={styles.permDirtyBarActions}>
            <button
              type="button"
              className={styles.btnGhost}
              onClick={handleCancel}
              disabled={saving}
              data-testid="role-perm-cancel"
            >
              取消
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() => void handleSave()}
              disabled={saving || !dirty}
              data-testid="role-perm-save"
            >
              {saving ? '保存中…' : '保存修改'}
            </button>
          </div>
        </div>
      )}

      {/* 资源分组列表 */}
      {groups.map(({ resource, items }) => {
        const folded = collapsed.has(resource);
        return (
          <div
            key={resource}
            className={styles.permResourceGroup}
            data-testid={`role-perm-group-${resource}`}
          >
            <div
              className={styles.permResourceHeader}
              onClick={() => toggleCollapse(resource)}
              role="button"
              aria-expanded={!folded}
              data-testid={`role-perm-group-toggle-${resource}`}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {folded ? (
                  <ChevronRight size={14} aria-hidden="true" />
                ) : (
                  <ChevronDown size={14} aria-hidden="true" />
                )}
                {formatResourceLabel(resource)}
              </span>
              <span className={styles.permResourceCount}>{items.length} 项</span>
            </div>
            {!folded &&
              items.map((p) => {
                const checked = localIds.has(p.id);
                return (
                  <label
                    key={p.id}
                    className={styles.permRow}
                    data-testid={`role-perm-row-${p.id}`}
                  >
                    <input
                      type="checkbox"
                      className={styles.matrixCheckbox}
                      checked={checked}
                      onChange={() => handleToggle(p.id)}
                      // race fix：保存进行中禁止编辑，避免被 GET 重拉结果覆盖。
                      // super_admin 整面板只读（与后端 422 守卫互为防御）。
                      disabled={isSuperAdmin || saving}
                      data-testid={`role-perm-checkbox-${p.id}`}
                    />
                    <span className={styles.permRowLabel}>
                      {formatActionLabel(p.resource, p.action)}
                      {p.scope !== 'all' && (
                        <span style={{ color: 'var(--faint)', fontSize: 10, marginLeft: 6 }}>
                          ({p.scope})
                        </span>
                      )}
                    </span>
                    <span className={styles.permRowCode}>{p.code}</span>
                  </label>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
