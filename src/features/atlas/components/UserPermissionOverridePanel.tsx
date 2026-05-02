/**
 * @file UserPermissionOverridePanel.tsx
 * @description 用户级权限 override 三态编辑面板（Task 11）。
 *
 *              与 Task 10 RolePermissionMatrix 互补：
 *                - RolePermissionMatrix 编辑"角色默认权限"（grant 列表全量替换）
 *                - 本组件编辑"单用户在角色基线上的 override"，三态语义：
 *                    inherit  —— 用户在 user_permissions 表中无该 perm 行，沿用角色默认
 *                    grant    —— 在角色未授予时显式追加
 *                    deny     —— 在角色已授予时显式撤销
 *
 *              工作流：
 *                1. mount 时 4 路并发拉数据：
 *                   - listAllPermissions()                   全量 catalog（左列展示用）
 *                   - getUserPermissionOverrides(userId)     用户已存的 override 行
 *                   - getRolePermissions(user.roleId)        角色基线（中列只读展示）
 *                   - 用户对象（atlasUsersStore）            取 displayName + roleId
 *                2. 把服务端 overrides 转成本地 Map<permissionId, 'inherit'|'grant'|'deny'>，
 *                   未在 overrides 中的 perm 默认 inherit
 *                3. chip 点击切换本地 Map；与服务端快照比对算 dirty
 *                4. 保存：仅提交 grant/deny 行（inherit 等价于"无行"），调
 *                   updateUserPermissionOverrides(userId, [{permissionId, effect}])，
 *                   写后重拉刷新快照
 *                5. Race fix（继承 Task 10）：保存进行中所有 chip + 按钮均 disabled
 *
 *              super_admin 用户（user.roleId == 1）：
 *                - 整面板只读 + 锁徽标 + 取消/保存按钮隐藏
 *                - 与后端 SuperAdminInvariants middleware 422 互为防御
 *
 * @author Atlas.oi
 * @date 2026-05-02
 */

import { useEffect, useMemo, useState } from 'react';
import { Lock } from 'lucide-react';

import {
  listAllPermissions,
  getRolePermissions,
  getUserPermissionOverrides,
  updateUserPermissionOverrides,
  type PermissionDTO,
  type UserPermissionOverrideDTO,
} from '../api/permissions';
import { useAtlasUsersStore } from '../stores/atlasUsersStore';
import { useAtlasRolesStore } from '../stores/atlasRolesStore';
import styles from '../atlas.module.css';

/** super_admin role ID 与后端 services.SuperAdminRoleID = 1 对齐 */
const SUPER_ADMIN_ROLE_ID = 1;

/** 三态枚举：与 backend services.UserOverride.Effect 对齐 + inherit 哨兵 */
type OverrideState = 'inherit' | 'grant' | 'deny';

interface UserPermissionOverridePanelProps {
  /** 目标用户 ID；调用方负责保证 atlasUsersStore.users 中存在该用户 */
  userId: number;
  /** 关闭面板回调（父容器决定是否显示，例如返回用户列表） */
  onClose?: () => void;
}

/**
 * 中文资源/动作名表（与 RolePermissionMatrix 同源）。
 *
 * 业务背景：本组件不再做 group 折叠（用户级 override 通常零星调整，整张表
 * 一屏可见反而高效）。但仍需要中文标签让非技术管理员能识别 perm 含义。
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

function formatActionLabel(resource: string, action: string): string {
  if (resource === 'event' && /^E\d+$/.test(action)) {
    return `事件 ${action}`;
  }
  return ACTION_CN[action] ?? action;
}

function formatResourceLabel(resource: string): string {
  return RESOURCE_CN[resource] ?? resource;
}

/** Map clone 工具：本地 state diff 用 */
function cloneMap<K, V>(m: Map<K, V>): Map<K, V> {
  return new Map(m);
}

/** 比较两个 override map 是否等价（仅 grant/deny 行参与对比；inherit == 缺失） */
function mapsEqual(a: Map<number, OverrideState>, b: Map<number, OverrideState>): boolean {
  // 只比较非 inherit 的项；inherit 等价于"map 中不存在该 key"
  const filterA = new Map([...a].filter(([, v]) => v !== 'inherit'));
  const filterB = new Map([...b].filter(([, v]) => v !== 'inherit'));
  if (filterA.size !== filterB.size) return false;
  for (const [k, v] of filterA) {
    if (filterB.get(k) !== v) return false;
  }
  return true;
}

export function UserPermissionOverridePanel({
  userId,
  onClose,
}: UserPermissionOverridePanelProps) {
  // 从 store 读取 user/role —— 调用方负责预先 load atlasUsersStore + atlasRolesStore
  const user = useAtlasUsersStore((s) => s.users.find((u) => u.id === userId));
  const role = useAtlasRolesStore((s) =>
    user ? s.roles.find((r) => r.id === user.roleId) : undefined,
  );

  const isSuperAdmin = user?.roleId === SUPER_ADMIN_ROLE_ID;

  const [allPerms, setAllPerms] = useState<PermissionDTO[]>([]);
  /** role 基线已授予的 perm id 集合（只读展示用） */
  const [roleBaseIds, setRoleBaseIds] = useState<Set<number>>(new Set());
  /** 服务端权威 overrides 快照 */
  const [serverOverrides, setServerOverrides] = useState<Map<number, OverrideState>>(new Map());
  /** 本地编辑中的 overrides */
  const [localOverrides, setLocalOverrides] = useState<Map<number, OverrideState>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // ============================================
  // 第一步：mount 时并发拉 catalog + overrides + role 基线
  // user 信息直接读 store，省一次网络往返
  // ============================================
  useEffect(() => {
    if (!user) {
      // 用户对象未在 store 中（父组件未 load） —— 不发请求等待 store 更新
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      listAllPermissions(),
      getUserPermissionOverrides(userId),
      getRolePermissions(user.roleId),
    ])
      .then(([catalog, overrides, roleBase]) => {
        if (cancelled) return;
        setAllPerms(catalog);
        setRoleBaseIds(new Set(roleBase.map((p) => p.id)));
        const map = new Map<number, OverrideState>();
        for (const o of overrides) {
          map.set(o.permissionId, o.effect);
        }
        setServerOverrides(map);
        setLocalOverrides(cloneMap(map));
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
  }, [userId, user]);

  // ============================================
  // 第二步：按 resource 分组排序（不折叠，只是为了视觉分块）
  // ============================================
  const sortedPerms = useMemo(() => {
    const order = [
      'progress',
      'project',
      'feedback',
      'payment',
      'file',
      'event',
      'users',
      'permissions',
      'nav',
      'role',
      'user',
      '*',
    ];
    return [...allPerms].sort((a, b) => {
      const ai = order.indexOf(a.resource);
      const bi = order.indexOf(b.resource);
      if (ai !== bi) {
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      }
      // 同 resource 按 action 字母序
      return a.action.localeCompare(b.action);
    });
  }, [allPerms]);

  // ============================================
  // 第三步：dirty 检测（super_admin 永远 false）
  // ============================================
  const dirty = !isSuperAdmin && !mapsEqual(localOverrides, serverOverrides);

  // ============================================
  // 行为：chip 点击 / save / cancel
  // ============================================
  const handleChipClick = (permId: number, next: OverrideState) => {
    if (isSuperAdmin || saving) return;
    const map = cloneMap(localOverrides);
    if (next === 'inherit') {
      map.delete(permId);
    } else {
      map.set(permId, next);
    }
    setLocalOverrides(map);
  };

  const handleSave = async () => {
    if (isSuperAdmin || saving || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      // 仅提交非 inherit 的条目（inherit == 后端不存行）
      const overrides: UserPermissionOverrideDTO[] = [...localOverrides.entries()]
        .filter(([, eff]) => eff !== 'inherit')
        .map(([permissionId, eff]) => ({
          permissionId,
          effect: eff as 'grant' | 'deny',
        }));
      await updateUserPermissionOverrides(userId, overrides);
      // 写后重拉服务端最新值刷快照（捕获其它管理员中间写入）
      const fresh = await getUserPermissionOverrides(userId);
      const freshMap = new Map<number, OverrideState>();
      for (const o of fresh) {
        freshMap.set(o.permissionId, o.effect);
      }
      setServerOverrides(freshMap);
      // race fix：保存途中 chip 已 disabled，本地态 == 提交态 == 服务端态
      setLocalOverrides(cloneMap(freshMap));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (saving) return;
    setLocalOverrides(cloneMap(serverOverrides));
  };

  // ============================================
  // 渲染
  // ============================================
  if (!user) {
    return (
      <div data-testid="user-perm-override" style={{ color: 'var(--muted)', padding: 24 }}>
        用户未加载（请先 load atlasUsersStore）
      </div>
    );
  }

  if (loading) {
    return (
      <div data-testid="user-perm-override" style={{ color: 'var(--muted)', padding: 24 }}>
        加载中…
      </div>
    );
  }

  return (
    <div data-testid="user-perm-override">
      {/* 头部：用户名 + 角色 + 锁/关闭 */}
      <div className={styles.permUserHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={styles.permRoleHeaderLabel}>用户</span>
          <span style={{ fontSize: 13, fontWeight: 700 }}>
            {user.displayName || user.username}
          </span>
          <span style={{ fontSize: 11, color: 'var(--faint)' }}>
            ({role?.name ?? `Role #${user.roleId}`})
          </span>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {isSuperAdmin && (
            <span
              className={styles.permLockBadge}
              data-testid="user-perm-superadmin-lock"
              title="超管账号不可编辑权限"
            >
              <Lock size={11} aria-hidden="true" />
              只读
            </span>
          )}
          {onClose && (
            <button
              type="button"
              className={styles.btnGhost}
              onClick={onClose}
              data-testid="user-perm-close"
            >
              返回
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className={styles.errorBox} data-testid="user-perm-error" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      {/* sticky 未保存修改条；super_admin 永远不显示 */}
      {dirty && !isSuperAdmin && (
        <div className={styles.permDirtyBar} data-testid="user-perm-dirty-bar">
          <span>存在未保存修改</span>
          <div className={styles.permDirtyBarActions}>
            <button
              type="button"
              className={styles.btnGhost}
              onClick={handleCancel}
              disabled={saving}
              data-testid="user-perm-cancel"
            >
              取消
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() => void handleSave()}
              disabled={saving || !dirty}
              data-testid="user-perm-save"
            >
              {saving ? '保存中…' : '保存 override'}
            </button>
          </div>
        </div>
      )}

      {/* 表头 */}
      <div
        className={styles.permOverrideRow}
        style={{
          background: 'var(--panel-2)',
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--faint)',
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          borderRadius: '8px 8px 0 0',
          border: '1px solid var(--line)',
        }}
      >
        <span>权限</span>
        <span style={{ textAlign: 'center' }}>角色基线</span>
        <span style={{ textAlign: 'center' }}>我的 override</span>
      </div>

      {/* 数据行容器（包一层 panel 让外圈圆角连续） */}
      <div
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          borderTop: 'none',
          borderRadius: '0 0 8px 8px',
        }}
      >
        {sortedPerms.map((p) => {
          const state: OverrideState = localOverrides.get(p.id) ?? 'inherit';
          const granted = roleBaseIds.has(p.id);
          return (
            <div
              key={p.id}
              className={styles.permOverrideRow}
              data-testid={`user-perm-row-${p.id}`}
            >
              {/* 列 1：中文标签 + code */}
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ color: 'var(--text)' }}>
                  {formatResourceLabel(p.resource)} · {formatActionLabel(p.resource, p.action)}
                </span>
                <span className={styles.permRowCode}>{p.code}</span>
              </span>

              {/* 列 2：role 基线（只读） */}
              <span
                className={
                  granted
                    ? `${styles.permRoleBaseCell} ${styles.permRoleBaseCellGranted}`
                    : styles.permRoleBaseCell
                }
                data-testid={`user-perm-role-base-${p.id}`}
              >
                {granted ? '✓' : '—'}
              </span>

              {/* 列 3：三态 chip 组（radio-style 单选） */}
              <span className={styles.permChipGroup} role="radiogroup">
                <button
                  type="button"
                  role="radio"
                  aria-checked={state === 'inherit'}
                  className={`${styles.permChip} ${
                    state === 'inherit' ? styles.permChipActiveInherit : ''
                  }`}
                  onClick={() => handleChipClick(p.id, 'inherit')}
                  disabled={isSuperAdmin || saving}
                  data-testid={`user-perm-chip-inherit-${p.id}`}
                >
                  继承
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={state === 'grant'}
                  className={`${styles.permChip} ${
                    state === 'grant' ? styles.permChipActiveGrant : ''
                  }`}
                  onClick={() => handleChipClick(p.id, 'grant')}
                  disabled={isSuperAdmin || saving}
                  data-testid={`user-perm-chip-grant-${p.id}`}
                >
                  + grant
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={state === 'deny'}
                  className={`${styles.permChip} ${
                    state === 'deny' ? styles.permChipActiveDeny : ''
                  }`}
                  onClick={() => handleChipClick(p.id, 'deny')}
                  disabled={isSuperAdmin || saving}
                  data-testid={`user-perm-chip-deny-${p.id}`}
                >
                  - deny
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
