/**
 * @file AtlasShell.tsx
 * @description Atlas 模块外壳（超管专用：用户管理 / 角色权限 / 系统配置）。
 *
 *              名称由来：双关 Atlas.oi 作者 + 希腊神祇阿特拉斯（举天）。
 *              寓意"系统管理者承担整个平台"。
 *
 *              路由策略：
 *                - 内部用 useState 切换 view，不引入 react-router
 *                - 三个 view 通过 display:none 切换，保留组件状态（避免重新拉数据）
 *
 *              访问控制：
 *                - 双层守卫：AppLayout 仅在 isAdmin 时挂载本组件；后端 RBAC 二次校验
 *                  （即使前端被篡改也会拿到 401 / 403）
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { useState } from 'react';
import { Users, Shield, Sliders } from 'lucide-react';

import { UsersTable } from './components/UsersTable';
import { RolesPermissionMatrix } from './components/RolesPermissionMatrix';
import { SystemConfigPanel } from './components/SystemConfigPanel';
import styles from './atlas.module.css';

type AtlasView = 'users' | 'roles' | 'config';

interface NavEntry {
  id: AtlasView;
  label: string;
  Icon: typeof Users;
  testId: string;
}

const NAV: NavEntry[] = [
  { id: 'users', label: '用户管理', Icon: Users, testId: 'atlas-nav-users' },
  { id: 'roles', label: '角色权限', Icon: Shield, testId: 'atlas-nav-roles' },
  { id: 'config', label: '系统配置', Icon: Sliders, testId: 'atlas-nav-config' },
];

export default function AtlasShell() {
  const [view, setView] = useState<AtlasView>('users');

  return (
    <div className={styles.atlasShell} data-testid="atlas-shell">
      {/* 左侧子导航 */}
      <nav className={styles.sidebar} aria-label="Atlas 导航">
        <div className={styles.sidebarTitle}>Atlas 控制台</div>
        {NAV.map(({ id, label, Icon, testId }) => (
          <button
            key={id}
            type="button"
            data-testid={testId}
            className={`${styles.navItem} ${view === id ? styles.navItemActive : ''}`}
            onClick={() => setView(id)}
            aria-current={view === id ? 'page' : undefined}
          >
            <Icon size={14} aria-hidden="true" />
            {label}
          </button>
        ))}
      </nav>

      {/* 主内容区：三个 view 通过 display:none 切换保留状态 */}
      <main className={styles.main}>
        <div style={{ display: view === 'users' ? 'block' : 'none' }}>
          <UsersTable />
        </div>
        <div style={{ display: view === 'roles' ? 'block' : 'none' }}>
          <RolesPermissionMatrix />
        </div>
        <div style={{ display: view === 'config' ? 'block' : 'none' }}>
          <SystemConfigPanel />
        </div>
      </main>
    </div>
  );
}
