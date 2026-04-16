/**
 * @file searchStore - 项目内全文搜索状态管理
 * @description 管理搜索弹窗的开关状态、搜索参数、结果列表和用户选中状态
 *              通过 Tauri invoke 调用 search_files_cmd，支持 300ms 防抖避免频繁请求
 * @author Atlas.oi
 * @date 2026-04-16
 */

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

/** 单条匹配行信息 */
export interface SearchMatch {
  /** 1-based 行号，对应 Rust 返回的 line_number */
  lineNumber: number;
  lineContent: string;
  columnStart: number;
  columnEnd: number;
}

/** 单文件搜索结果 */
export interface SearchFileResult {
  /** 相对路径，用于 UI 展示 */
  filePath: string;
  /** 绝对路径，用于打开文件 */
  absPath: string;
  matches: SearchMatch[];
  /** 该文件匹配条数超过 50 条时截断 */
  truncated: boolean;
}

/** search_files_cmd 返回结构 */
interface SearchResultResponse {
  files: SearchFileResult[];
  /** 匹配文件数超过 200 时截断 */
  truncated: boolean;
}

/** 搜索选项：大小写、全词、正则 */
export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
}

/** searchStore 完整状态和 Action 接口 */
interface SearchState {
  isOpen: boolean;
  projectPath: string | null;
  activeTab: 'content' | 'filename';
  query: string;
  options: SearchOptions;
  fileGlob: string;
  results: SearchFileResult[];
  selectedFileIdx: number;
  selectedMatchIdx: number;
  isSearching: boolean;
  truncated: boolean;

  // Actions
  open: (projectPath: string) => void;
  close: () => void;
  setTab: (tab: 'content' | 'filename') => void;
  setQuery: (q: string) => void;
  setOptions: (opts: Partial<SearchOptions>) => void;
  setFileGlob: (glob: string) => void;
  navigate: (dir: 'up' | 'down') => void;
  confirmSelection: () => void;
}

// 防抖计时器：模块作用域确保跨渲染共享同一个 timer，clearTimeout 能正确取消
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 执行实际搜索请求
 *
 * 业务逻辑：
 * 1. 读取当前状态：projectPath、query、activeTab、options、fileGlob
 * 2. query 为空时直接清空结果，不发起 invoke
 * 3. 调用 search_files_cmd，将结果写入 store
 * 4. invoke 失败时静默清空结果，避免 UI 停留在 loading 状态
 */
const _runSearch = async (
  get: () => SearchState,
  set: (partial: Partial<SearchState>) => void
) => {
  const { projectPath, query, activeTab, options, fileGlob } = get();
  if (!projectPath || !query.trim()) {
    set({ results: [], isSearching: false, truncated: false });
    return;
  }

  set({ isSearching: true });
  try {
    const result = await invoke<SearchResultResponse>('search_files_cmd', {
      params: {
        rootPath: projectPath,
        query,
        mode: activeTab,
        caseSensitive: options.caseSensitive,
        wholeWord: options.wholeWord,
        useRegex: options.useRegex,
        // fileGlob 为空字符串时传 null，Rust 端接收 Option<String>
        fileGlob: fileGlob || null,
      },
    });
    set({
      results: result.files,
      truncated: result.truncated,
      isSearching: false,
      // 新搜索结果出来后重置选中位置到第一条
      selectedFileIdx: 0,
      selectedMatchIdx: 0,
    });
  } catch {
    // invoke 失败（如后端超时）静默清空，不向上传递异常
    set({ isSearching: false, results: [] });
  }
};

export const useSearchStore = create<SearchState>((set, get) => ({
  // ============================================================
  // 初始状态
  // ============================================================
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

  // ============================================================
  // Actions
  // ============================================================

  /**
   * 打开搜索弹窗，绑定当前项目路径
   * 每次打开重置结果和选中位置，但保留上次的 query 方便用户继续搜索
   */
  open: (projectPath) => {
    set({
      isOpen: true,
      projectPath,
      results: [],
      selectedFileIdx: 0,
      selectedMatchIdx: 0,
      truncated: false,
    });
  },

  /**
   * 关闭搜索弹窗
   * 不清空 query，下次打开可直接继续使用上次的关键词
   */
  close: () => {
    set({ isOpen: false });
  },

  /**
   * 切换搜索模式（内容搜索 / 文件名搜索）
   * 切换后立即重新执行搜索
   */
  setTab: (tab) => {
    set({ activeTab: tab });
    _runSearch(get, set);
  },

  /**
   * 更新搜索关键词，带 300ms 防抖
   * query 为空时立即清空结果，不进入防抖等待
   */
  setQuery: (q) => {
    set({ query: q });
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!q.trim()) {
      set({ results: [], isSearching: false, truncated: false });
      return;
    }
    debounceTimer = setTimeout(() => _runSearch(get, set), 300);
  },

  /**
   * 更新搜索选项（大小写/全词/正则），立即重新搜索
   * 使用 Partial 允许只更新部分选项
   */
  setOptions: (opts) => {
    set((state) => ({ options: { ...state.options, ...opts } }));
    _runSearch(get, set);
  },

  /**
   * 更新文件 glob 过滤器，立即重新搜索
   * 例：'*.ts' 仅搜索 TypeScript 文件
   */
  setFileGlob: (glob) => {
    set({ fileGlob: glob });
    _runSearch(get, set);
  },

  /**
   * 键盘导航搜索结果
   *
   * 业务逻辑：
   * - down：当前文件下一条 → 跨文件到下一个文件第一条 → 最后一条停留
   * - up：当前文件上一条 → 跨文件到上一个文件最后一条 → 第一条停留
   */
  navigate: (dir) => {
    const { results, selectedFileIdx, selectedMatchIdx } = get();
    if (results.length === 0) return;

    if (dir === 'down') {
      const currentFile = results[selectedFileIdx];
      if (selectedMatchIdx < currentFile.matches.length - 1) {
        // 当前文件还有下一条匹配
        set({ selectedMatchIdx: selectedMatchIdx + 1 });
      } else if (selectedFileIdx < results.length - 1) {
        // 跨文件：移到下一个文件的第一条
        set({ selectedFileIdx: selectedFileIdx + 1, selectedMatchIdx: 0 });
      }
      // 已是最后一条，停留（不越界）
    } else {
      if (selectedMatchIdx > 0) {
        // 当前文件还有上一条匹配
        set({ selectedMatchIdx: selectedMatchIdx - 1 });
      } else if (selectedFileIdx > 0) {
        // 跨文件：移到上一个文件的最后一条
        const prevFile = results[selectedFileIdx - 1];
        set({
          selectedFileIdx: selectedFileIdx - 1,
          selectedMatchIdx: prevFile.matches.length - 1,
        });
      }
      // 已是第一条，停留（不越界）
    }
  },

  /**
   * 确认选中当前高亮的匹配项
   *
   * 业务逻辑：
   * 1. 取当前选中的文件和匹配行
   * 2. 动态导入 editorStore，调用 openFile 跳转到对应行
   * 3. 关闭搜索弹窗（query 保留）
   *
   * 使用动态 import 避免 searchStore ↔ editorStore 循环依赖
   */
  confirmSelection: () => {
    const { results, selectedFileIdx, selectedMatchIdx } = get();
    const file = results[selectedFileIdx];
    if (!file) return;
    const match = file.matches[selectedMatchIdx];
    if (!match) return;

    // 先打开文件，再关闭弹窗，确保 editorStore 状态更新后 UI 才消失
    import('../../features/editor/editorStore').then(({ useEditorStore }) => {
      useEditorStore.getState().openFile(file.absPath, match.lineNumber);
      get().close();
    });
  },
}));
