/**
 * @file sidebarStore.test.ts
 * @description sidebarStore 单元测试 - 验证标签切换和显隐切换行为
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useSidebarStore } from '../sidebarStore';

// 每个测试前重置 store 到初始状态，避免测试间互相影响
beforeEach(() => {
  useSidebarStore.setState({
    activeTab: 'files',
    visible: true,
  });
});

describe('sidebarStore - setTab', () => {
  it('初始状态应为 files 标签', () => {
    const { activeTab } = useSidebarStore.getState();
    expect(activeTab).toBe('files');
  });

  it('setTab 应切换到 changes', () => {
    const { setTab } = useSidebarStore.getState();
    setTab('changes');
    expect(useSidebarStore.getState().activeTab).toBe('changes');
  });

  it('setTab 应切换到 worktrees', () => {
    const { setTab } = useSidebarStore.getState();
    setTab('worktrees');
    expect(useSidebarStore.getState().activeTab).toBe('worktrees');
  });

  it('setTab 应切换回 files', () => {
    const { setTab } = useSidebarStore.getState();
    setTab('changes');
    setTab('files');
    expect(useSidebarStore.getState().activeTab).toBe('files');
  });
});

describe('sidebarStore - toggleVisibility', () => {
  it('初始状态侧边栏应可见', () => {
    const { visible } = useSidebarStore.getState();
    expect(visible).toBe(true);
  });

  it('toggleVisibility 应隐藏侧边栏', () => {
    const { toggleVisibility } = useSidebarStore.getState();
    toggleVisibility();
    expect(useSidebarStore.getState().visible).toBe(false);
  });

  it('再次 toggleVisibility 应恢复显示', () => {
    const { toggleVisibility } = useSidebarStore.getState();
    toggleVisibility();
    toggleVisibility();
    expect(useSidebarStore.getState().visible).toBe(true);
  });
});
