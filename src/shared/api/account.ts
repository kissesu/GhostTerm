/**
 * @file account.ts
 * @description 当前登录用户的"个人中心"自助 API client（薄包装：apiFetch + zod）。
 *
 *              对应后端 endpoint：
 *                - PATCH /api/auth/me              修改 displayName / username
 *                - POST  /api/auth/change-password 修改密码（需要旧密码二次校验）
 *
 *              复用 progress 模块的 apiFetch / UserSchema —— 全局 authStore 已经
 *              统一注入 Bearer + 401 silent refresh，本文件无需重复处理 token。
 *
 *              与 features/atlas/api/users.ts 的区别：
 *                - 本文件只能改"自己" —— 后端用 ctx 取 userId，无 path param
 *                - atlas/users.ts 是超管改"别人"的工具 —— 路径含 {id}
 *
 * @author Atlas.oi
 * @date 2026-05-03
 */

import { z } from 'zod';

import { apiFetch } from '../../features/progress/api/client';
import { UserSchema, type UserPayload } from '../../features/progress/api/schemas';

// ============================================
// 入参类型（与 OAS AuthUpdateMeRequest / ChangePasswordRequest 对齐）
// ============================================

export interface UpdateMyProfileInput {
  // 任一字段缺省 = 不修改；空字符串会被后端校验拒绝
  displayName?: string;
  username?: string;
}

export interface ChangePasswordInput {
  oldPassword: string;
  newPassword: string;
}

// ============================================
// API 函数
// ============================================

/**
 * PATCH /api/auth/me —— 修改当前登录用户的基础信息（个人中心）。
 *
 * 业务背景：超管改"别人"必须走 atlas/users.ts；本函数仅允许改"自己"
 * 且字段范围被后端限制为 displayName / username（不含 roleId / isActive）。
 *
 * @returns 更新后的 UserPayload（不含 permissions —— 与 atlas 列表一致返空数组）
 */
export async function updateMyProfile(input: UpdateMyProfileInput): Promise<UserPayload> {
  return apiFetch(
    '/api/auth/me',
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
    UserSchema,
  );
}

/**
 * POST /api/auth/change-password —— 修改当前登录用户的密码（个人中心）。
 *
 * 业务背景：
 *   - 后端 bcrypt 校验旧密码；错误返 401（前端展示"旧密码错误"）
 *   - 成功后递增 token_version 让其它会话失效；当前 access token 仍可短期使用，
 *     由调用方展示"密码已修改，建议重新登录"提示
 *   - 不在本函数自动 logout —— 用户原话 2026-05-03"修改密码后让用户手动重登"
 *
 * @returns 无返回值（204 No Content）
 */
export async function changePassword(input: ChangePasswordInput): Promise<void> {
  await apiFetch(
    '/api/auth/change-password',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    z.void(),
  );
}
