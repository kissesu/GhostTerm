/**
 * @file api/users.ts
 * @description Atlas 模块用户管理 API client（薄包装：apiFetch + zod）。
 *
 *              复用 progress 模块的 apiFetch / UserSchema —— 全局 authStore 已经
 *              统一注入 Bearer，本文件无需重复处理 token。
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { z } from 'zod';

import { apiFetch } from '../../progress/api/client';
import { UserSchema, type UserPayload } from '../../progress/api/schemas';

// ============================================
// schemas
// ============================================

const UserListSchema = z.array(UserSchema);

// ============================================
// 入参类型（与 oas UserCreateRequest / UserUpdateRequest 对齐）
// ============================================
export interface UserCreateInput {
  username: string;
  password: string;
  displayName?: string;
  roleId: number;
}

export interface UserUpdateInput {
  username?: string;
  password?: string;
  displayName?: string;
  roleId?: number;
  isActive?: boolean;
}

// ============================================
// API 函数
// ============================================

/** GET /api/users —— 列出所有用户（仅超管） */
export async function listUsers(): Promise<UserPayload[]> {
  return apiFetch('/api/users', { method: 'GET' }, UserListSchema);
}

/** POST /api/users —— 创建用户（仅超管） */
export async function createUser(input: UserCreateInput): Promise<UserPayload> {
  return apiFetch(
    '/api/users',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    UserSchema,
  );
}

/** PATCH /api/users/{id} —— 修改用户（仅超管） */
export async function updateUser(id: number, input: UserUpdateInput): Promise<UserPayload> {
  return apiFetch(
    `/api/users/${id}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
    UserSchema,
  );
}

/** DELETE /api/users/{id} —— 软删除用户（仅超管） */
export async function deleteUser(id: number): Promise<void> {
  await apiFetch(`/api/users/${id}`, { method: 'DELETE' }, z.void());
}
