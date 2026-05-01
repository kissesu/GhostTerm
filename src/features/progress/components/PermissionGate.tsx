/**
 * @file PermissionGate.tsx
 * @description 权限门控组件 - subscribe progressPermissionStore，无权限时不渲染 children
 *              Task 33 完整实现；Task 18 起即可用（默认 permissions 空 = 无权限，等 Task 34 接通联动）
 *              测试中 mock 此组件直渲 children 以屏蔽权限检查干扰。
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import type { ReactNode, ReactElement } from 'react';
import { useProgressPermissionStore } from '../stores/progressPermissionStore';
import type { Permission } from '../api/permissions';

interface PermissionGateProps {
  perm: Permission | string;
  children: ReactNode;
  fallback?: ReactNode;
}

export function PermissionGate({ perm, children, fallback = null }: PermissionGateProps): ReactElement {
  const has = useProgressPermissionStore((s) => s.has(perm as Permission));
  return <>{has ? children : fallback}</>;
}
