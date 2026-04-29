/**
 * @file permissions.ts
 * @description 进度模块前端使用的权限码（perm code）类型与常量。
 *
 *              业务背景：
 *              - 后端 /api/auth/me 响应里的 user.permissions 是 string[]，
 *                每个元素形如 "<resource>:<action>"（spec §5）
 *              - 前端 PermissionGate / usePermission 用同一个字符串做断言，
 *                无需把整张权限表 enumerate；本文件仅给"高频被引用"的权限码起常量名，
 *                方便 grep + IDE 跳转
 *              - 如果某 perm 还没在常量表里出现，直接传字符串字面量也合法，
 *                类型 Permission = string 确保编译不会卡
 *
 *              新增权限码时不必改本文件 —— 只在 UI gate 真的引用某 perm 时
 *              才把它加入 PERM 常量；保持本文件最小化即可。
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

/**
 * 权限码 = "<resource>:<action>"。
 *
 * 示例：
 *   - "project:read"      → 资源级权限（spec §5.2）
 *   - "customer:create"   → 资源级权限
 *   - "event:E10"         → 状态机事件触发权（spec §5.3 / §6.2）
 *   - "*:*"               → 超管通配（仅 role_id=1 持有）
 */
export type Permission = string;

/**
 * 高频权限码常量。仅收录"UI gate 实际用到"的权限，避免 string union 维护负担。
 *
 * 命名规范：
 *   - 资源 + 动作：PROJECT_READ / CUSTOMER_CREATE
 *   - 状态机事件：EVENT_<EventCode>，如 EVENT_E10
 */
export const PERM = {
  // 资源级权限（spec §5.2）
  PROJECT_READ: 'project:read',
  PROJECT_CREATE: 'project:create',
  PROJECT_UPDATE: 'project:update',

  CUSTOMER_READ: 'customer:read',
  CUSTOMER_CREATE: 'customer:create',

  FEEDBACK_READ: 'feedback:read',
  FEEDBACK_CREATE: 'feedback:create',

  PAYMENT_READ: 'payment:read',
  PAYMENT_CREATE: 'payment:create',

  FILE_READ: 'file:read',
  FILE_UPLOAD: 'file:upload',

  // 状态机事件触发权限（spec §6.2 / §5.3）
  EVENT_E1: 'event:E1',
  EVENT_E2: 'event:E2',
  EVENT_E4: 'event:E4',
  EVENT_E5: 'event:E5',
  EVENT_E7: 'event:E7',
  EVENT_E9: 'event:E9',
  EVENT_E10: 'event:E10',
  EVENT_E11: 'event:E11',
  EVENT_E12: 'event:E12',

  // 超管通配
  ALL: '*:*',
} as const;

/** PERM 对象任一字面量取值（编辑器智能补全用） */
export type PermissionCode = (typeof PERM)[keyof typeof PERM];
