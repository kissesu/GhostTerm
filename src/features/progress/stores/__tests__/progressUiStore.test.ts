/**
 * @file progressUiStore.test.ts
 * @description progressUiStore 行为契约
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProgressUiStore } from '../progressUiStore';

beforeEach(() => {
  useProgressUiStore.setState({
    currentView: 'kanban',
    selectedProjectId: null,
    priorView: null,
    statusFilter: 'all',
    searchQuery: '',
  });
});

describe('progressUiStore', () => {
  it('openProjectFromView 同时更新 selectedProjectId + priorView', () => {
    useProgressUiStore.getState().openProjectFromView(42, 'kanban');
    const s = useProgressUiStore.getState();
    expect(s.selectedProjectId).toBe(42);
    expect(s.priorView).toBe('kanban');
  });

  it('closeProject 重置两字段', () => {
    useProgressUiStore.setState({ selectedProjectId: 1, priorView: 'list' });
    useProgressUiStore.getState().closeProject();
    expect(useProgressUiStore.getState().selectedProjectId).toBeNull();
    expect(useProgressUiStore.getState().priorView).toBeNull();
  });

  it('setStatusFilter 切换 filter', () => {
    useProgressUiStore.getState().setStatusFilter('developing');
    expect(useProgressUiStore.getState().statusFilter).toBe('developing');
  });
});
