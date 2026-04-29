/**
 * @file usePermission.test.tsx
 * @description Phase 3 usePermission hook + PermissionGate 组件渲染测试。
 *              覆盖：
 *              - usePermission 返回 true / false 的基础行为
 *              - PermissionGate 缺权时不渲染 children
 *              - 权限变化（hydrate）后组件重渲染
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { PermissionGate } from '../../components/PermissionGate';
import { useProgressPermissionStore } from '../../stores/progressPermissionStore';
import { usePermission, useCan } from '../usePermission';

beforeEach(() => {
  useProgressPermissionStore.getState().clear();
});

// ============================================
// usePermission：单纯 hook 行为
// ============================================

function ProbeUsePermission({ perm }: { perm: string }) {
  const allowed = usePermission(perm);
  return <div data-testid="probe">{allowed ? 'allowed' : 'denied'}</div>;
}

describe('usePermission', () => {
  it('空 store → denied', () => {
    render(<ProbeUsePermission perm="project:read" />);
    expect(screen.getByTestId('probe').textContent).toBe('denied');
  });

  it('hydrate 命中 → allowed，且 store 变化时组件重渲染', () => {
    render(<ProbeUsePermission perm="project:read" />);
    expect(screen.getByTestId('probe').textContent).toBe('denied');

    act(() => {
      useProgressPermissionStore.getState().hydrate(['project:read']);
    });
    expect(screen.getByTestId('probe').textContent).toBe('allowed');

    // 切换到不在集合里的 perm（改 store 移除）
    act(() => {
      useProgressPermissionStore.getState().clear();
    });
    expect(screen.getByTestId('probe').textContent).toBe('denied');
  });

  it('通配 *:* 让任意 perm allowed', () => {
    act(() => {
      useProgressPermissionStore.getState().hydrate(['*:*']);
    });
    render(<ProbeUsePermission perm="event:E10" />);
    expect(screen.getByTestId('probe').textContent).toBe('allowed');
  });

  it('useCan 是 usePermission 别名', () => {
    function Probe({ perm }: { perm: string }) {
      const allowed = useCan(perm);
      return <span data-testid="can">{String(allowed)}</span>;
    }
    act(() => {
      useProgressPermissionStore.getState().hydrate(['customer:create']);
    });
    render(<Probe perm="customer:create" />);
    expect(screen.getByTestId('can').textContent).toBe('true');
  });
});

// ============================================
// PermissionGate
// ============================================

describe('PermissionGate', () => {
  it('缺权时不渲染 children（默认 fallback=null）', () => {
    render(
      <PermissionGate perm="project:create">
        <button data-testid="create-btn">创建</button>
      </PermissionGate>,
    );
    expect(screen.queryByTestId('create-btn')).toBeNull();
  });

  it('拥有权限时渲染 children', () => {
    act(() => {
      useProgressPermissionStore.getState().hydrate(['project:create']);
    });
    render(
      <PermissionGate perm="project:create">
        <button data-testid="create-btn">创建</button>
      </PermissionGate>,
    );
    expect(screen.getByTestId('create-btn')).toBeTruthy();
  });

  it('缺权时渲染自定义 fallback', () => {
    render(
      <PermissionGate
        perm="project:create"
        fallback={<span data-testid="tip">需更高权限</span>}
      >
        <button>创建</button>
      </PermissionGate>,
    );
    expect(screen.getByTestId('tip')).toBeTruthy();
  });

  it('权限动态变化时切换渲染分支', () => {
    const { rerender } = render(
      <PermissionGate perm="event:E10">
        <span data-testid="trigger">触发</span>
      </PermissionGate>,
    );
    expect(screen.queryByTestId('trigger')).toBeNull();

    act(() => {
      useProgressPermissionStore.getState().hydrate(['event:E10']);
    });
    rerender(
      <PermissionGate perm="event:E10">
        <span data-testid="trigger">触发</span>
      </PermissionGate>,
    );
    expect(screen.getByTestId('trigger')).toBeTruthy();
  });
});
