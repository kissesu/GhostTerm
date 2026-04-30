/**
 * @file EventActionButtons.test.tsx
 * @description Phase 11 事件按钮面板单测：
 *              - 有 perm → 按钮渲染
 *              - 缺 perm → 按钮被 PermissionGate 隐藏
 *              - status='dealing' 显示 E1 + E12（取消）
 *              - status='cancelled' 仅显示 E13（重启）
 *              - status='paid' 显示 E11
 *              - 点击按钮打开 EventTriggerDialog（dialog 出现）
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../api/projects', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    listProjects: vi.fn(),
    createProject: vi.fn(),
    getProject: vi.fn(),
    updateProject: vi.fn(),
    triggerProjectEvent: vi.fn(),
  };
});

import { EventActionButtons } from '../EventActionButtons';
import { useProgressPermissionStore } from '../../stores/progressPermissionStore';

beforeEach(() => {
  useProgressPermissionStore.getState().clear();
});

describe('EventActionButtons 权限守卫', () => {
  it('缺权限 → 不渲染 E1 按钮（dealing 状态）', () => {
    useProgressPermissionStore.getState().hydrate([]);
    render(<EventActionButtons projectId={1} status="dealing" />);
    expect(screen.queryByTestId('event-action-E1')).toBeNull();
  });

  it('给 event:E1 + event:E12 → dealing 状态显示这两个按钮', () => {
    useProgressPermissionStore.getState().hydrate(['event:E1', 'event:E12']);
    render(<EventActionButtons projectId={1} status="dealing" />);
    expect(screen.getByTestId('event-action-E1')).toBeInTheDocument();
    expect(screen.getByTestId('event-action-E12')).toBeInTheDocument();
    // dealing 不应有 E13（重启）
    expect(screen.queryByTestId('event-action-E13')).toBeNull();
  });

  it('通配 *:* → 显示当前 status 所有可触发事件', () => {
    useProgressPermissionStore.getState().hydrate(['*:*']);
    render(<EventActionButtons projectId={1} status="quoting" />);
    expect(screen.getByTestId('event-action-E2')).toBeInTheDocument();
    expect(screen.getByTestId('event-action-E3')).toBeInTheDocument();
    expect(screen.getByTestId('event-action-E4')).toBeInTheDocument();
    expect(screen.getByTestId('event-action-E5')).toBeInTheDocument();
    expect(screen.getByTestId('event-action-E6')).toBeInTheDocument();
    expect(screen.getByTestId('event-action-E12')).toBeInTheDocument();
  });
});

describe('EventActionButtons 状态过滤', () => {
  beforeEach(() => {
    useProgressPermissionStore.getState().hydrate(['*:*']);
  });

  it('status=cancelled → 仅 E13（重启），无 E12', () => {
    render(<EventActionButtons projectId={1} status="cancelled" />);
    expect(screen.getByTestId('event-action-E13')).toBeInTheDocument();
    expect(screen.queryByTestId('event-action-E12')).toBeNull();
  });

  it('status=paid → 显示 E11（归档）+ E12', () => {
    render(<EventActionButtons projectId={1} status="paid" />);
    expect(screen.getByTestId('event-action-E11')).toBeInTheDocument();
    expect(screen.getByTestId('event-action-E12')).toBeInTheDocument();
  });

  it('status=archived → 显示 E_AS1（报售后），无 E12', () => {
    render(<EventActionButtons projectId={1} status="archived" />);
    expect(screen.getByTestId('event-action-E_AS1')).toBeInTheDocument();
    // archived 是终态，E12 取消不适用
    expect(screen.queryByTestId('event-action-E12')).toBeNull();
  });

  it('status=after_sales → 显示 E_AS3', () => {
    render(<EventActionButtons projectId={1} status="after_sales" />);
    expect(screen.getByTestId('event-action-E_AS3')).toBeInTheDocument();
  });
});

describe('EventActionButtons 点击触发弹窗', () => {
  it('点击 E1 按钮打开 EventTriggerDialog', () => {
    useProgressPermissionStore.getState().hydrate(['*:*']);
    render(<EventActionButtons projectId={1} status="dealing" />);

    expect(screen.queryByTestId('event-trigger-dialog')).toBeNull();

    fireEvent.click(screen.getByTestId('event-action-E1'));

    expect(screen.getByTestId('event-trigger-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('event-trigger-dialog')).toHaveAttribute('data-event', 'E1');
  });
});
