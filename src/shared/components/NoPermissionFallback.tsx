/**
 * @file NoPermissionFallback.tsx
 * @description 用户已登录但无任何 nav tab 权限时的全屏兜底页。
 *
 *              触发场景（AppLayout 中 Task 9 引入）：
 *              - 后端 GET /api/me/effective-permissions 已 fetch 完成
 *              - has('nav:view:work') / has('nav:view:progress') / has('nav:view:atlas')
 *                三者均 false（典型场景：管理员把所有 nav 权限撤销）
 *
 *              交互：
 *              - 提供"退出登录"按钮：调 globalAuthStore.logout()
 *                让用户回到登录页换号或联系管理员重新授权
 *
 *              不提供"刷新"按钮：权限变更后端会 bump token_version，
 *              旧 access token 必失效；用户重登即可拉到新权限。
 *
 * @author Atlas.oi
 * @date 2026-05-02
 */

import { ShieldOff } from 'lucide-react';

import { useGlobalAuthStore } from '../stores/globalAuthStore';
import styles from './NoPermissionFallback.module.css';

/**
 * 全屏无权限兜底页。
 *
 * 业务流程：
 * 1. 渲染图标 + 文案 + 退出按钮
 * 2. 点击退出 → 调 useGlobalAuthStore.logout（异步；UI 不等待）
 *    logout 完成后 globalAuthStore.user 变 null，AppLayout 自然渲染登录页
 */
export default function NoPermissionFallback() {
  // 用 selector 拿 logout action 而非 getState()：避免 LSP noUnusedLocals 误判 import
  // （memory: feedback_zustand_getstate_lsp_unused_locals_use_selector）
  const logout = useGlobalAuthStore((s) => s.logout);

  return (
    <div className={styles.root} data-testid="no-permission-fallback">
      <div className={styles.card} role="alertdialog" aria-labelledby="no-perm-title">
        <ShieldOff size={56} className={styles.icon} aria-hidden="true" />
        <h1 id="no-perm-title" className={styles.title}>
          无任何模块访问权限
        </h1>
        <p className={styles.subtitle}>
          当前账号未被授予任何工作区访问权限，请联系管理员开通后再使用。
        </p>
        <button
          type="button"
          className={styles.logoutBtn}
          onClick={() => void logout()}
          data-testid="no-permission-logout"
        >
          退出登录
        </button>
      </div>
    </div>
  );
}
