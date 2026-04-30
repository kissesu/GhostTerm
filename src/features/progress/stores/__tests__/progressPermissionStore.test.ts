/**
 * @file progressPermissionStore.test.ts
 * @description Phase 3 permission store 单测：
 *              - hydrateFromMe / hydrate 写入
 *              - has() 通配 / 完全匹配 / 半通配 / 不命中
 *              - clear() 清空
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { useProgressPermissionStore } from '../progressPermissionStore';

beforeEach(() => {
  useProgressPermissionStore.getState().clear();
});

describe('progressPermissionStore.has', () => {
  it('空集合任何 perm 都返回 false', () => {
    const { has } = useProgressPermissionStore.getState();
    expect(has('project:read')).toBe(false);
    expect(has('event:E10')).toBe(false);
  });

  it('通配 *:* 任何 perm 都返回 true（超管）', () => {
    useProgressPermissionStore.getState().hydrate(['*:*']);
    const { has } = useProgressPermissionStore.getState();
    expect(has('project:read')).toBe(true);
    expect(has('customer:create')).toBe(true);
    expect(has('event:E10')).toBe(true);
    expect(has('anything:goes')).toBe(true);
  });

  it('完全匹配命中', () => {
    useProgressPermissionStore.getState().hydrate(['project:read', 'customer:create']);
    const { has } = useProgressPermissionStore.getState();
    expect(has('project:read')).toBe(true);
    expect(has('customer:create')).toBe(true);
    expect(has('project:write')).toBe(false);
    expect(has('event:E10')).toBe(false);
  });

  it('半通配 resource:* 命中所有该资源动作', () => {
    useProgressPermissionStore.getState().hydrate(['project:*']);
    const { has } = useProgressPermissionStore.getState();
    expect(has('project:read')).toBe(true);
    expect(has('project:write')).toBe(true);
    expect(has('customer:read')).toBe(false);
  });

  it('半通配 *:action 命中所有资源该动作', () => {
    useProgressPermissionStore.getState().hydrate(['*:read']);
    const { has } = useProgressPermissionStore.getState();
    expect(has('project:read')).toBe(true);
    expect(has('customer:read')).toBe(true);
    expect(has('project:write')).toBe(false);
  });

  it('非法格式的 perm（无冒号）返回 false', () => {
    useProgressPermissionStore.getState().hydrate(['*:*']);
    const { has } = useProgressPermissionStore.getState();
    // *:* 通配仍命中
    expect(has('noColon')).toBe(true);

    useProgressPermissionStore.getState().hydrate(['project:read']);
    const { has: has2 } = useProgressPermissionStore.getState();
    expect(has2('noColon')).toBe(false);
    expect(has2('')).toBe(false);
  });
});

describe('progressPermissionStore.hydrateFromMe', () => {
  it('从 me 响应里取 permissions 字段', () => {
    useProgressPermissionStore.getState().hydrateFromMe({
      permissions: ['project:read', 'event:E10'],
    });
    const { has } = useProgressPermissionStore.getState();
    expect(has('project:read')).toBe(true);
    expect(has('event:E10')).toBe(true);
    expect(has('customer:create')).toBe(false);
  });

  it('permissions 字段缺失（旧响应）→ 空 Set', () => {
    // 模拟旧 me 响应缺 permissions（schema parse 之前的脏数据）
    useProgressPermissionStore.getState().hydrateFromMe({
      permissions: undefined as unknown as string[],
    });
    expect(useProgressPermissionStore.getState().permissions.size).toBe(0);
  });
});

describe('progressPermissionStore.clear', () => {
  it('clear 后任何 perm 都失败', () => {
    useProgressPermissionStore.getState().hydrate(['*:*']);
    expect(useProgressPermissionStore.getState().has('project:read')).toBe(true);

    useProgressPermissionStore.getState().clear();
    expect(useProgressPermissionStore.getState().has('project:read')).toBe(false);
    expect(useProgressPermissionStore.getState().permissions.size).toBe(0);
  });
});
