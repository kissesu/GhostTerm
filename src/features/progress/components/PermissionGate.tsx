/**
 * @file PermissionGate.tsx
 * @description 权限守卫组件：当前用户拥有 perm 时渲染 children，否则渲染 fallback（默认 null）。
 *
 *              典型用法：
 *                <PermissionGate perm="event:E10">
 *                  <Button onClick={handleConfirm}>确认收款</Button>
 *                </PermissionGate>
 *
 *              进阶：缺权时显示禁用提示
 *                <PermissionGate perm="project:create" fallback={<Tip>需超管权限</Tip>}>
 *                  <CreateButton />
 *                </PermissionGate>
 *
 *              语义边界（不在本组件做的事）：
 *              - 不调后端校验：本组件仅是 UI 守卫，避免无权用户看到不该看到的入口；
 *                真正的权限校验在后端 RequirePerm 中间件，前端瞒掉的 fetch 仍会被拦下
 *              - 不做 loading 态：permissions 由 me 拉取，未加载时 store 为空 Set，
 *                所有 perm 一律 false → 默认 null，UI 自然降级（菜单逐渐"亮起来"）
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import type { ReactNode } from 'react';

import { usePermission } from '../hooks/usePermission';
import type { Permission } from '../api/permissions';

interface PermissionGateProps {
  /** 必须拥有的权限码 */
  perm: Permission;
  /** 拥有 perm 时渲染的内容 */
  children: ReactNode;
  /** 缺权时的兜底渲染；缺省 = 不渲染任何 DOM */
  fallback?: ReactNode;
}

/**
 * 守卫组件：仅在用户拥有 perm 时渲染 children。
 */
export function PermissionGate({ perm, children, fallback = null }: PermissionGateProps) {
  const allowed = usePermission(perm);
  return <>{allowed ? children : fallback}</>;
}
