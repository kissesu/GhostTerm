/**
 * @file eventGate.ts
 * @description 进度模块事件按钮可见性 gate（前端镜像 server/internal/services/statemachine/transitions.go）。
 *
 *              业务规则（2026-05-04 决策）：
 *              - admin (role_id=1) 兜底放行所有事件
 *              - E12/E13 取消/重启：FromHolderRole=nil，按 progress:project:cancel 权限控制
 *              - 其他事件（E2-E5/E7-E11/E_AS1/E_AS3）：按 holder 控制——只有 project.holderUserId === user.id 可触发
 *
 *              这镜像后端 statemachine.CanFire 的两层校验（status + holder）+
 *              ProjectHandler.checkCancelPermission 的细粒度 cancel 权限。
 *
 *              不在权限白名单的用户即使能看到项目也不应看到 CTA 按钮，
 *              避免点了被后端拒（差 UX）。
 *
 * @author Atlas.oi
 * @date 2026-05-04
 */
import type { EventCode, Project } from '../api/projects';

/** FromHolderRole=nil 的事件：不靠 holder 校验，靠权限码兜底（与后端 ProjectHandler 对齐） */
const CANCEL_EVENTS = new Set<EventCode>(['E12', 'E13']); // progress:project:cancel
const AFTER_SALES_EVENTS = new Set<EventCode>(['E_AS1']); // progress:project:after_sales

/** 用户简表（与 globalAuthStore.user shape 对齐） */
export interface CurrentUser {
  id: number;
  roleId: number;
}

/**
 * 判断当前用户是否可以触发 / 看到该事件按钮。
 *
 * @param eventCode 事件码
 * @param project   项目上下文（提供 holderUserId）
 * @param user      当前登录用户；null 时一律隐藏
 * @param hasCancelPerm 是否拥有 progress:project:cancel 权限（E12/E13）
 * @param hasAfterSalesPerm 是否拥有 progress:project:after_sales 权限（E_AS1）
 */
export function canTriggerEvent(
  eventCode: EventCode,
  project: Pick<Project, 'holderUserId'>,
  user: CurrentUser | null,
  hasCancelPerm: boolean,
  hasAfterSalesPerm: boolean = false,
): boolean {
  if (!user) return false;
  // admin 兜底（role_id=1，与后端 statemachine.RoleAdmin 对齐）
  if (user.roleId === 1) return true;
  if (CANCEL_EVENTS.has(eventCode)) {
    return hasCancelPerm;
  }
  if (AFTER_SALES_EVENTS.has(eventCode)) {
    return hasAfterSalesPerm;
  }
  // 其他事件：必须是 holder 本人
  return project.holderUserId === user.id;
}
