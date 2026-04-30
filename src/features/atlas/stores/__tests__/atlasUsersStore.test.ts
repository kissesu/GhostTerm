/**
 * @file atlasUsersStore.test.ts
 * @description atlasUsersStore 单测：load / create / update / delete + 错误暴露。
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/users', () => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
}));

import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
} from '../../api/users';
import { useAtlasUsersStore } from '../atlasUsersStore';

const mockedList = vi.mocked(listUsers);
const mockedCreate = vi.mocked(createUser);
const mockedUpdate = vi.mocked(updateUser);
const mockedDelete = vi.mocked(deleteUser);

const SAMPLE_USER = {
  id: 1,
  username: 'alice',
  displayName: 'Alice',
  roleId: 2,
  isActive: true,
  createdAt: '2026-04-29T00:00:00Z',
  permissions: [] as string[],
};

beforeEach(() => {
  useAtlasUsersStore.setState({ users: [], loading: false, error: null });
  mockedList.mockReset();
  mockedCreate.mockReset();
  mockedUpdate.mockReset();
  mockedDelete.mockReset();
});

describe('atlasUsersStore.load', () => {
  it('成功加载后填充 users 并清 loading', async () => {
    mockedList.mockResolvedValueOnce([SAMPLE_USER]);
    await useAtlasUsersStore.getState().load();
    const s = useAtlasUsersStore.getState();
    expect(s.users).toEqual([SAMPLE_USER]);
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
  });

  it('加载失败时写 error 并 rethrow', async () => {
    mockedList.mockRejectedValueOnce(new Error('network'));
    await expect(useAtlasUsersStore.getState().load()).rejects.toThrow('network');
    expect(useAtlasUsersStore.getState().error).toBe('network');
  });
});

describe('atlasUsersStore.createUser', () => {
  it('创建后追加到 users', async () => {
    mockedCreate.mockResolvedValueOnce(SAMPLE_USER);
    const created = await useAtlasUsersStore.getState().createUser({
      username: 'alice',
      password: 'secret123',
      roleId: 2,
    });
    expect(created).toEqual(SAMPLE_USER);
    expect(useAtlasUsersStore.getState().users).toEqual([SAMPLE_USER]);
  });
});

describe('atlasUsersStore.updateUser', () => {
  it('更新后用返回值替换匹配项', async () => {
    useAtlasUsersStore.setState({ users: [SAMPLE_USER] });
    const updated = { ...SAMPLE_USER, displayName: 'New Name' };
    mockedUpdate.mockResolvedValueOnce(updated);
    await useAtlasUsersStore.getState().updateUser(1, { displayName: 'New Name' });
    expect(useAtlasUsersStore.getState().users[0].displayName).toBe('New Name');
  });
});

describe('atlasUsersStore.deleteUser', () => {
  it('删除后从 users 中移除', async () => {
    useAtlasUsersStore.setState({ users: [SAMPLE_USER] });
    mockedDelete.mockResolvedValueOnce(undefined);
    await useAtlasUsersStore.getState().deleteUser(1);
    expect(useAtlasUsersStore.getState().users).toEqual([]);
  });
});
