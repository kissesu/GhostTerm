/**
 * @file useKeyboardShortcuts.test.ts
 * @description useKeyboardShortcuts hook 单元测试 - 验证三个全局快捷键（PBI-6.6）。
 *              测试 Cmd+B（侧边栏切换）、Cmd+`（焦点切换）、Cmd+S（保存文件）
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';
import { useSidebarStore } from '../../../features/sidebar/sidebarStore';
import { useEditorStore } from '../../../features/editor/editorStore';

beforeEach(() => {
  vi.clearAllMocks();
  // 重置 sidebar store，确保测试隔离
  useSidebarStore.setState({ activeTab: 'files', visible: true });
});

describe('useKeyboardShortcuts - Cmd+B 侧边栏切换', () => {
  it('Cmd+B 应调用 sidebarStore.toggleVisibility（无 onSidebarToggle 时直接操作 store）', () => {
    // 监视 toggleVisibility 函数
    const mockToggle = vi.fn();
    useSidebarStore.setState({ toggleVisibility: mockToggle });

    renderHook(() => useKeyboardShortcuts());
    fireEvent.keyDown(window, { key: 'b', metaKey: true });

    expect(mockToggle).toHaveBeenCalledTimes(1);
  });

  it('提供 onSidebarToggle 时 Cmd+B 应调用回调而非直接操作 store', () => {
    // 有回调时优先走回调，让布局组件同步 userCollapsedRef
    const mockToggle = vi.fn();
    const onSidebarToggle = vi.fn();
    useSidebarStore.setState({ toggleVisibility: mockToggle });

    renderHook(() => useKeyboardShortcuts(undefined, onSidebarToggle));
    fireEvent.keyDown(window, { key: 'b', metaKey: true });

    expect(onSidebarToggle).toHaveBeenCalledTimes(1);
    // store 的 toggleVisibility 不应被直接调用（由回调负责）
    expect(mockToggle).not.toHaveBeenCalled();
  });

  it('Ctrl+B 也应触发 toggleVisibility（跨平台）', () => {
    const mockToggle = vi.fn();
    useSidebarStore.setState({ toggleVisibility: mockToggle });

    renderHook(() => useKeyboardShortcuts());
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });

    expect(mockToggle).toHaveBeenCalledTimes(1);
  });

  it('无修饰键的 B 不应触发', () => {
    const mockToggle = vi.fn();
    useSidebarStore.setState({ toggleVisibility: mockToggle });

    renderHook(() => useKeyboardShortcuts());
    fireEvent.keyDown(window, { key: 'b' });

    expect(mockToggle).not.toHaveBeenCalled();
  });
});

describe('useKeyboardShortcuts - Cmd+` 焦点切换', () => {
  it('Cmd+` 应调用 onFocusToggle("terminal")', () => {
    const onFocusToggle = vi.fn();

    renderHook(() => useKeyboardShortcuts(onFocusToggle));
    fireEvent.keyDown(window, { key: '`', metaKey: true });

    expect(onFocusToggle).toHaveBeenCalledWith('terminal');
  });

  it('未传 onFocusToggle 时 Cmd+` 不应报错', () => {
    // 没有传入回调时，应静默处理（不抛出）
    renderHook(() => useKeyboardShortcuts(undefined));
    expect(() =>
      fireEvent.keyDown(window, { key: '`', metaKey: true }),
    ).not.toThrow();
  });
});

describe('useKeyboardShortcuts - Cmd+S 保存文件', () => {
  it('Cmd+S 有激活文件时应调用 saveFile', () => {
    const mockSave = vi.fn().mockResolvedValue(undefined);
    useEditorStore.setState({
      activeFilePath: '/test/file.ts',
      saveFile: mockSave,
    });

    renderHook(() => useKeyboardShortcuts());
    fireEvent.keyDown(window, { key: 's', metaKey: true });

    expect(mockSave).toHaveBeenCalledWith('/test/file.ts');
  });

  it('Cmd+S 无激活文件时不应调用 saveFile', () => {
    const mockSave = vi.fn();
    useEditorStore.setState({ activeFilePath: null, saveFile: mockSave });

    renderHook(() => useKeyboardShortcuts());
    fireEvent.keyDown(window, { key: 's', metaKey: true });

    expect(mockSave).not.toHaveBeenCalled();
  });

  it('hook 卸载后 Cmd+S 不应再触发', () => {
    const mockSave = vi.fn().mockResolvedValue(undefined);
    useEditorStore.setState({
      activeFilePath: '/test/file.ts',
      saveFile: mockSave,
    });

    // unmount 时应移除事件监听器
    const { unmount } = renderHook(() => useKeyboardShortcuts());
    unmount();

    fireEvent.keyDown(window, { key: 's', metaKey: true });
    expect(mockSave).not.toHaveBeenCalled();
  });
});
