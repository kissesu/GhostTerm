/**
 * @file searchStore 单元测试
 * @description 测试搜索状态管理：open/close、setQuery 防抖、navigate 导航、confirmSelection 跳转
 * @author Atlas.oi
 * @date 2026-04-16
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

// mock editorStore，避免动态 import 触发真实 Tauri 调用
// 必须在模块顶层声明，vitest 会提升 vi.mock 调用
const mockOpenFile = vi.fn().mockResolvedValue(undefined);
vi.mock('../../editor/editorStore', () => ({
  useEditorStore: {
    getState: () => ({ openFile: mockOpenFile }),
  },
}));

describe('searchStore', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // 重置 store 到初始状态
    const { useSearchStore } = await import('../searchStore');
    useSearchStore.setState({
      isOpen: false,
      projectPath: null,
      activeTab: 'content',
      query: '',
      options: { caseSensitive: false, wholeWord: false, useRegex: false },
      fileGlob: '',
      results: [],
      selectedFileIdx: 0,
      selectedMatchIdx: 0,
      isSearching: false,
      truncated: false,
    });
  });

  describe('open', () => {
    it('设置 isOpen=true、projectPath，清空 results', async () => {
      const { useSearchStore } = await import('../searchStore');

      // 先放入一些旧结果
      useSearchStore.setState({ results: [{ filePath: 'old.ts', absPath: '/old.ts', matches: [], truncated: false }] });

      useSearchStore.getState().open('/project/myapp');

      const state = useSearchStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.projectPath).toBe('/project/myapp');
      expect(state.results).toHaveLength(0);
      expect(state.selectedFileIdx).toBe(0);
      expect(state.selectedMatchIdx).toBe(0);
    });
  });

  describe('close', () => {
    it('设置 isOpen=false，保留 query 不清空', async () => {
      const { useSearchStore } = await import('../searchStore');
      useSearchStore.setState({ isOpen: true, query: 'fn main' });

      useSearchStore.getState().close();

      const state = useSearchStore.getState();
      expect(state.isOpen).toBe(false);
      // query 保留，下次打开可继续使用
      expect(state.query).toBe('fn main');
    });
  });

  describe('setQuery', () => {
    it('空字符串时立即清空 results，不调用 invoke', async () => {
      const { useSearchStore } = await import('../searchStore');
      useSearchStore.setState({
        results: [{ filePath: 'a.ts', absPath: '/a.ts', matches: [], truncated: false }],
        isSearching: true,
      });

      useSearchStore.getState().setQuery('');

      const state = useSearchStore.getState();
      expect(state.results).toHaveLength(0);
      expect(state.isSearching).toBe(false);
      // 空字符串不触发 invoke
      expect(invoke).not.toHaveBeenCalled();
    });

    it('非空字符串时更新 query，防抖后调用 invoke', async () => {
      vi.useFakeTimers();
      vi.mocked(invoke).mockResolvedValue({ files: [], truncated: false });

      const { useSearchStore } = await import('../searchStore');
      useSearchStore.setState({ projectPath: '/project' });

      useSearchStore.getState().setQuery('hello');

      // 防抖期间 invoke 未调用
      expect(invoke).not.toHaveBeenCalled();
      expect(useSearchStore.getState().query).toBe('hello');

      // 推进 300ms 触发防抖
      await vi.runAllTimersAsync();

      expect(invoke).toHaveBeenCalledWith('search_files_cmd', expect.objectContaining({
        params: expect.objectContaining({ query: 'hello' }),
      }));

      vi.useRealTimers();
    });

    it('连续调用 setQuery 只触发最后一次 invoke', async () => {
      vi.useFakeTimers();
      vi.mocked(invoke).mockResolvedValue({ files: [], truncated: false });

      const { useSearchStore } = await import('../searchStore');
      useSearchStore.setState({ projectPath: '/project' });

      useSearchStore.getState().setQuery('a');
      useSearchStore.getState().setQuery('ab');
      useSearchStore.getState().setQuery('abc');

      await vi.runAllTimersAsync();

      // 只有最后一次查询触发 invoke
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(invoke).toHaveBeenCalledWith('search_files_cmd', expect.objectContaining({
        params: expect.objectContaining({ query: 'abc' }),
      }));

      vi.useRealTimers();
    });
  });

  describe('navigate', () => {
    it('down：在当前文件内移到下一条匹配', async () => {
      const { useSearchStore } = await import('../searchStore');
      useSearchStore.setState({
        results: [
          {
            filePath: 'a.ts',
            absPath: '/a.ts',
            truncated: false,
            matches: [
              { lineNumber: 1, lineContent: 'line1', columnStart: 0, columnEnd: 3 },
              { lineNumber: 5, lineContent: 'line5', columnStart: 0, columnEnd: 3 },
            ],
          },
        ],
        selectedFileIdx: 0,
        selectedMatchIdx: 0,
      });

      useSearchStore.getState().navigate('down');

      const state = useSearchStore.getState();
      expect(state.selectedFileIdx).toBe(0);
      expect(state.selectedMatchIdx).toBe(1);
    });

    it('down：当前文件最后一条时跨文件到下一个文件第一条', async () => {
      const { useSearchStore } = await import('../searchStore');
      useSearchStore.setState({
        results: [
          {
            filePath: 'a.ts',
            absPath: '/a.ts',
            truncated: false,
            matches: [{ lineNumber: 1, lineContent: 'x', columnStart: 0, columnEnd: 1 }],
          },
          {
            filePath: 'b.ts',
            absPath: '/b.ts',
            truncated: false,
            matches: [{ lineNumber: 3, lineContent: 'y', columnStart: 0, columnEnd: 1 }],
          },
        ],
        selectedFileIdx: 0,
        selectedMatchIdx: 0,
      });

      useSearchStore.getState().navigate('down');

      const state = useSearchStore.getState();
      expect(state.selectedFileIdx).toBe(1);
      expect(state.selectedMatchIdx).toBe(0);
    });

    it('down：已是最后一条时不越界，停留', async () => {
      const { useSearchStore } = await import('../searchStore');
      useSearchStore.setState({
        results: [
          {
            filePath: 'a.ts',
            absPath: '/a.ts',
            truncated: false,
            matches: [{ lineNumber: 1, lineContent: 'x', columnStart: 0, columnEnd: 1 }],
          },
        ],
        selectedFileIdx: 0,
        selectedMatchIdx: 0,
      });

      useSearchStore.getState().navigate('down');

      // 已是最后一条（唯一文件唯一匹配），不应越界
      const state = useSearchStore.getState();
      expect(state.selectedFileIdx).toBe(0);
      expect(state.selectedMatchIdx).toBe(0);
    });

    it('up：在当前文件内移到上一条匹配', async () => {
      const { useSearchStore } = await import('../searchStore');
      useSearchStore.setState({
        results: [
          {
            filePath: 'a.ts',
            absPath: '/a.ts',
            truncated: false,
            matches: [
              { lineNumber: 1, lineContent: 'line1', columnStart: 0, columnEnd: 3 },
              { lineNumber: 5, lineContent: 'line5', columnStart: 0, columnEnd: 3 },
            ],
          },
        ],
        selectedFileIdx: 0,
        selectedMatchIdx: 1,
      });

      useSearchStore.getState().navigate('up');

      const state = useSearchStore.getState();
      expect(state.selectedFileIdx).toBe(0);
      expect(state.selectedMatchIdx).toBe(0);
    });

    it('up：当前文件第一条时跨文件到上一个文件最后一条', async () => {
      const { useSearchStore } = await import('../searchStore');
      useSearchStore.setState({
        results: [
          {
            filePath: 'a.ts',
            absPath: '/a.ts',
            truncated: false,
            matches: [
              { lineNumber: 1, lineContent: 'x', columnStart: 0, columnEnd: 1 },
              { lineNumber: 2, lineContent: 'y', columnStart: 0, columnEnd: 1 },
            ],
          },
          {
            filePath: 'b.ts',
            absPath: '/b.ts',
            truncated: false,
            matches: [{ lineNumber: 10, lineContent: 'z', columnStart: 0, columnEnd: 1 }],
          },
        ],
        selectedFileIdx: 1,
        selectedMatchIdx: 0,
      });

      useSearchStore.getState().navigate('up');

      const state = useSearchStore.getState();
      // 跨到上一个文件（a.ts），停在最后一条（index=1）
      expect(state.selectedFileIdx).toBe(0);
      expect(state.selectedMatchIdx).toBe(1);
    });

    it('results 为空时不报错', async () => {
      const { useSearchStore } = await import('../searchStore');
      useSearchStore.setState({ results: [], selectedFileIdx: 0, selectedMatchIdx: 0 });

      // 不应抛出异常
      expect(() => useSearchStore.getState().navigate('down')).not.toThrow();
      expect(() => useSearchStore.getState().navigate('up')).not.toThrow();
    });
  });

  describe('confirmSelection', () => {
    it('调用 editorStore.openFile 并 close 弹窗', async () => {
      const { useSearchStore } = await import('../searchStore');
      useSearchStore.setState({
        isOpen: true,
        results: [
          {
            filePath: 'src/main.ts',
            absPath: '/project/src/main.ts',
            truncated: false,
            matches: [
              { lineNumber: 42, lineContent: 'fn main()', columnStart: 0, columnEnd: 7 },
            ],
          },
        ],
        selectedFileIdx: 0,
        selectedMatchIdx: 0,
      });

      useSearchStore.getState().confirmSelection();

      // 等待动态 import 完成
      await vi.waitFor(() => {
        expect(mockOpenFile).toHaveBeenCalledWith('/project/src/main.ts', 42);
      });

      // close() 已调用
      expect(useSearchStore.getState().isOpen).toBe(false);
    });

    it('results 为空时不报错', async () => {
      const { useSearchStore } = await import('../searchStore');
      useSearchStore.setState({ results: [], selectedFileIdx: 0, selectedMatchIdx: 0 });

      expect(() => useSearchStore.getState().confirmSelection()).not.toThrow();
      expect(mockOpenFile).not.toHaveBeenCalled();
    });
  });
});
