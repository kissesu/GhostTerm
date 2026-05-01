/**
 * @file progressPermissionStore.test.ts
 * @description progressPermissionStore 行为契约
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProgressPermissionStore } from '../progressPermissionStore';

beforeEach(() => {
  useProgressPermissionStore.getState().clear();
});

describe('progressPermissionStore', () => {
  it('set + has 正确', () => {
    useProgressPermissionStore.getState().set(['event:E1', 'event:E12'] as any);
    expect(useProgressPermissionStore.getState().has('event:E1')).toBe(true);
    expect(useProgressPermissionStore.getState().has('event:E99')).toBe(false);
  });

  it('clear 后 has 全 false', () => {
    useProgressPermissionStore.getState().set(['event:E1'] as any);
    useProgressPermissionStore.getState().clear();
    expect(useProgressPermissionStore.getState().has('event:E1')).toBe(false);
  });

  it('set 用新数组覆盖旧权限（不累加）', () => {
    useProgressPermissionStore.getState().set(['event:E1'] as any);
    useProgressPermissionStore.getState().set(['event:E2'] as any);
    expect(useProgressPermissionStore.getState().has('event:E1')).toBe(false);
    expect(useProgressPermissionStore.getState().has('event:E2')).toBe(true);
  });

  it('全局通配 "*:*" 命中任意 perm（super_admin 场景）', () => {
    useProgressPermissionStore.getState().set(['*:*'] as any);
    expect(useProgressPermissionStore.getState().has('event:E1')).toBe(true);
    expect(useProgressPermissionStore.getState().has('feedback:create')).toBe(true);
    expect(useProgressPermissionStore.getState().has('any:perm')).toBe(true);
  });

  it('namespace 通配 "<ns>:*" 命中同 ns perm', () => {
    useProgressPermissionStore.getState().set(['event:*'] as any);
    expect(useProgressPermissionStore.getState().has('event:E1')).toBe(true);
    expect(useProgressPermissionStore.getState().has('event:E_AS3')).toBe(true);
    expect(useProgressPermissionStore.getState().has('feedback:create')).toBe(false);
  });

  it('精确匹配 + 全局通配同时存在不冲突', () => {
    useProgressPermissionStore.getState().set(['*:*', 'event:E1'] as any);
    expect(useProgressPermissionStore.getState().has('event:E1')).toBe(true);
    expect(useProgressPermissionStore.getState().has('event:E12')).toBe(true);
  });
});
