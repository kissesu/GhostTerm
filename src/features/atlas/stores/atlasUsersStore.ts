/**
 * @file atlasUsersStore.ts
 * @description Atlas 用户管理 store。
 *
 *              负责用户列表的加载和增删改：
 *                - load()          GET 列表
 *                - createUser()    POST 后追加到本地
 *                - updateUser()    PATCH 后用返回值替换本地匹配项
 *                - deleteUser()    DELETE 后从本地移除（软删后端置 is_active=false，
 *                                  但前端从列表中拿掉以避免视觉混淆）
 *
 *              错误暴露为 store.error；调用方按需 catch（不静默吞）。
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { create } from 'zustand';

import type { UserPayload } from '../../progress/api/schemas';
import {
  listUsers,
  createUser as apiCreateUser,
  updateUser as apiUpdateUser,
  deleteUser as apiDeleteUser,
  type UserCreateInput,
  type UserUpdateInput,
} from '../api/users';

interface AtlasUsersState {
  users: UserPayload[];
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  createUser: (input: UserCreateInput) => Promise<UserPayload>;
  updateUser: (id: number, input: UserUpdateInput) => Promise<UserPayload>;
  deleteUser: (id: number) => Promise<void>;
  clearError: () => void;
}

export const useAtlasUsersStore = create<AtlasUsersState>((set, get) => ({
  users: [],
  loading: false,
  error: null,

  async load() {
    set({ loading: true, error: null });
    try {
      const users = await listUsers();
      set({ users, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  },

  async createUser(input) {
    const created = await apiCreateUser(input);
    set({ users: [...get().users, created] });
    return created;
  },

  async updateUser(id, input) {
    const updated = await apiUpdateUser(id, input);
    set({
      users: get().users.map((u) => (u.id === id ? updated : u)),
    });
    return updated;
  },

  async deleteUser(id) {
    await apiDeleteUser(id);
    set({ users: get().users.filter((u) => u.id !== id) });
  },

  clearError() {
    set({ error: null });
  },
}));
