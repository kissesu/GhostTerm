/**
 * @file useOpenWithFile.test.ts
 * @description useOpenWithFile hook 单元测试 - 验证回归保护：
 *              "Open With" 仅打开文件，不修改当前项目（不调用 openProject）。
 *              测试两条通路（启动队列 + 实时事件）均遵守此契约。
 * @author Atlas.oi
 * @date 2026-04-27
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useOpenWithFile } from '../useOpenWithFile';
import { useProjectStore } from '../../../features/sidebar/projectStore';
import { useEditorStore } from '../../../features/editor/editorStore';

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useOpenWithFile - 不持久化父目录到项目列表', () => {
  it('启动队列里的文件应调用 openFile，不调用 openProject', async () => {
    // 模拟 Rust setup 阶段暂存了一个文件路径
    mockInvoke.mockResolvedValueOnce(['/foo/bar/sample.md']);
    // listen 立即返回 noop unlisten
    mockListen.mockResolvedValue(() => undefined);

    // 监视两个 store 的关键 action
    const openProjectSpy = vi.fn();
    const openFileSpy = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState({ openProject: openProjectSpy });
    useEditorStore.setState({ openFile: openFileSpy });

    renderHook(() => useOpenWithFile());

    // 等异步链路（invoke + openFile）完成
    await waitFor(() => {
      expect(openFileSpy).toHaveBeenCalledWith('/foo/bar/sample.md');
    });

    // 关键回归断言：openProject 不应被调用
    expect(openProjectSpy).not.toHaveBeenCalled();
  });

  it('实时 ghostterm:open-with-file 事件也仅 openFile，不 openProject', async () => {
    mockInvoke.mockResolvedValueOnce([]); // 启动队列空
    // 捕获 listener，模拟外部触发事件
    let capturedListener: ((event: { payload: string }) => void) | null = null;
    mockListen.mockImplementation((_event, handler) => {
      capturedListener = handler as typeof capturedListener;
      return Promise.resolve(() => undefined);
    });

    const openProjectSpy = vi.fn();
    const openFileSpy = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState({ openProject: openProjectSpy });
    useEditorStore.setState({ openFile: openFileSpy });

    renderHook(() => useOpenWithFile());

    // 等 listen 注册完成
    await waitFor(() => {
      expect(capturedListener).not.toBeNull();
    });

    // 模拟 Rust 端 emit 事件（用户在 Finder 再次"打开方式"）
    capturedListener!({ payload: '/external/note.txt' });

    await waitFor(() => {
      expect(openFileSpy).toHaveBeenCalledWith('/external/note.txt');
    });

    expect(openProjectSpy).not.toHaveBeenCalled();
  });

  it('hook unmount 时应取消事件监听（避免内存泄漏）', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    const unlistenSpy = vi.fn();
    mockListen.mockResolvedValue(unlistenSpy);

    const { unmount } = renderHook(() => useOpenWithFile());

    // 等 listen 完成赋值
    await waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    unmount();

    // unlisten 应在 cleanup 中被调用
    expect(unlistenSpy).toHaveBeenCalledTimes(1);
  });
});
