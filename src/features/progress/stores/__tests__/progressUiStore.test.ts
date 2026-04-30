/**
 * @file progressUiStore.test.ts
 * @description Phase 10 UI store 单测：
 *              - currentView 切换
 *              - searchQuery / statusFilter 设置
 *              - selectedProjectId 切换
 *              - reset 重置全部
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { useProgressUiStore } from '../progressUiStore';

beforeEach(() => {
  useProgressUiStore.getState().reset();
});

describe('progressUiStore.currentView', () => {
  it('默认为 list 视图', () => {
    expect(useProgressUiStore.getState().currentView).toBe('list');
  });

  it('setCurrentView 切换到 kanban', () => {
    useProgressUiStore.getState().setCurrentView('kanban');
    expect(useProgressUiStore.getState().currentView).toBe('kanban');
  });

  it('setCurrentView 切换回 list', () => {
    useProgressUiStore.getState().setCurrentView('kanban');
    useProgressUiStore.getState().setCurrentView('list');
    expect(useProgressUiStore.getState().currentView).toBe('list');
  });
});

describe('progressUiStore.searchQuery', () => {
  it('默认为空串', () => {
    expect(useProgressUiStore.getState().searchQuery).toBe('');
  });

  it('setSearchQuery 写入查询', () => {
    useProgressUiStore.getState().setSearchQuery('张三');
    expect(useProgressUiStore.getState().searchQuery).toBe('张三');
  });
});

describe('progressUiStore.statusFilter', () => {
  it('默认为 all', () => {
    expect(useProgressUiStore.getState().statusFilter).toBe('all');
  });

  it('setStatusFilter 切换到具体 status', () => {
    useProgressUiStore.getState().setStatusFilter('developing');
    expect(useProgressUiStore.getState().statusFilter).toBe('developing');
  });

  it('setStatusFilter 切换回 all', () => {
    useProgressUiStore.getState().setStatusFilter('developing');
    useProgressUiStore.getState().setStatusFilter('all');
    expect(useProgressUiStore.getState().statusFilter).toBe('all');
  });
});

describe('progressUiStore.selectedProjectId', () => {
  it('默认为 null', () => {
    expect(useProgressUiStore.getState().selectedProjectId).toBeNull();
  });

  it('setSelectedProject 写入 id', () => {
    useProgressUiStore.getState().setSelectedProject(42);
    expect(useProgressUiStore.getState().selectedProjectId).toBe(42);
  });

  it('setSelectedProject(null) 回到列表', () => {
    useProgressUiStore.getState().setSelectedProject(42);
    useProgressUiStore.getState().setSelectedProject(null);
    expect(useProgressUiStore.getState().selectedProjectId).toBeNull();
  });
});

describe('progressUiStore.reset', () => {
  it('reset 清空所有 UI 状态', () => {
    const s = useProgressUiStore.getState();
    s.setCurrentView('kanban');
    s.setSearchQuery('xx');
    s.setStatusFilter('paid');
    s.setSelectedProject(99);

    s.reset();

    const after = useProgressUiStore.getState();
    expect(after.currentView).toBe('list');
    expect(after.searchQuery).toBe('');
    expect(after.statusFilter).toBe('all');
    expect(after.selectedProjectId).toBeNull();
  });
});
