/**
 * @file usePermission.test.tsx
 * @description usePermission hook 单测：验证 has() 正确反映 progressPermissionStore 状态
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { usePermission } from '../usePermission';
import { useProgressPermissionStore } from '../../stores/progressPermissionStore';

// ============================================
// 每个测试前把 store 清空，保证测试隔离
// ============================================
beforeEach(() => {
  useProgressPermissionStore.getState().clear();
});

describe('usePermission', () => {
  it('returns false when store is empty', () => {
    const { result } = renderHook(() => usePermission('event:E1'));
    expect(result.current).toBe(false);
  });

  it('returns true when the perm is present in the store', () => {
    act(() => {
      useProgressPermissionStore.getState().set(['event:E1', 'project:read']);
    });
    const { result } = renderHook(() => usePermission('event:E1'));
    expect(result.current).toBe(true);
  });

  it('returns false for a perm not in the store', () => {
    act(() => {
      useProgressPermissionStore.getState().set(['event:E1']);
    });
    const { result } = renderHook(() => usePermission('event:E7'));
    expect(result.current).toBe(false);
  });

  it('returns false after clear()', () => {
    act(() => {
      useProgressPermissionStore.getState().set(['event:E1', 'project:read']);
    });
    act(() => {
      useProgressPermissionStore.getState().clear();
    });
    const { result } = renderHook(() => usePermission('event:E1'));
    expect(result.current).toBe(false);
  });

  it('reacts to store update mid-render', () => {
    const { result } = renderHook(() => usePermission('payment:create'));
    expect(result.current).toBe(false);

    // 登录后 store 被 set → hook 应响应更新
    act(() => {
      useProgressPermissionStore.getState().set(['payment:create']);
    });
    expect(result.current).toBe(true);

    // 登出后 clear → hook 应响应更新
    act(() => {
      useProgressPermissionStore.getState().clear();
    });
    expect(result.current).toBe(false);
  });
});
