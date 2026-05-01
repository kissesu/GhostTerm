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
});
