/**
 * @file editorStore - 编辑器状态管理
 * @description 管理多标签文件编辑器状态：打开/关闭/保存文件，标签页切换，脏标记追踪
 *              通过 Tauri invoke 与后端 fs_backend Commands 交互
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { OpenFile, ReadFileResult } from '../../shared/types';

/** 根据文件路径后缀推断 CodeMirror 语言标识符 */
function inferLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const langMap: Record<string, string> = {
    ts: 'ts',
    tsx: 'tsx',
    js: 'js',
    jsx: 'jsx',
    rs: 'rs',
    json: 'json',
    html: 'html',
    css: 'css',
    py: 'py',
    md: 'md',
    toml: 'toml',
    yaml: 'yaml',
    yml: 'yaml',
    sh: 'sh',
    bash: 'sh',
  };
  return langMap[ext] ?? ext;
}

/** 将后端 ReadFileResult 转换为前端 OpenFile 对象 */
function resultToOpenFile(path: string, result: ReadFileResult): OpenFile {
  const language = inferLanguage(path);

  switch (result.kind) {
    case 'text':
      return {
        path,
        content: result.content,
        diskContent: result.content,
        isDirty: false,
        language,
        kind: 'text',
      };
    case 'binary':
      return {
        path,
        content: '',
        diskContent: '',
        isDirty: false,
        language,
        kind: 'binary',
        mimeHint: result.mime_hint,
      };
    case 'large':
      return {
        path,
        content: '',
        diskContent: '',
        isDirty: false,
        language,
        kind: 'large',
      };
    case 'error':
      return {
        path,
        content: '',
        diskContent: '',
        isDirty: false,
        language,
        kind: 'error',
        errorMessage: result.message,
      };
  }
}

/** 编辑器状态接口 */
interface EditorState {
  /** 当前所有已打开的文件 */
  openFiles: OpenFile[];
  /** 当前激活的文件路径 */
  activeFilePath: string | null;

  /** 打开文件：invoke read_file_cmd → 根据 kind 设置 OpenFile */
  openFile: (path: string) => Promise<void>;
  /** 关闭文件：从 openFiles 中移除，切换 activeFilePath */
  closeFile: (path: string) => void;
  /** 关闭所有文件：切换项目时清空编辑器状态 */
  closeAll: () => void;
  /** 保存文件：invoke write_file_cmd → 更新 diskContent + isDirty=false */
  saveFile: (path: string) => Promise<void>;
  /** 切换激活标签 */
  setActive: (path: string) => void;
  /** 关闭其他标签，仅保留目标文件 */
  closeOthers: (path: string) => void;
  /** 关闭目标左侧所有标签 */
  closeLeft: (path: string) => void;
  /** 关闭目标右侧所有标签 */
  closeRight: (path: string) => void;
  /** 更新编辑器内容，自动计算 isDirty */
  updateContent: (path: string, content: string) => void;
  /** 处理外部文件变化（PBI-4 时完整实现，此处为骨架） */
  handleExternalChange: (path: string) => Promise<void>;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  openFiles: [],
  activeFilePath: null,

  openFile: async (path: string) => {
    const { openFiles } = get();

    // 文件已打开时仅切换 active，不重复读取
    const existing = openFiles.find((f) => f.path === path);
    if (existing) {
      set({ activeFilePath: path });
      return;
    }

    // 通过 Tauri Command 读取文件
    const result = await invoke<ReadFileResult>('read_file_cmd', { path });
    const newFile = resultToOpenFile(path, result);

    set((state) => ({
      openFiles: [...state.openFiles, newFile],
      activeFilePath: path,
    }));
  },

  closeAll: () => {
    // 切换项目时清空所有已打开文件，避免旧项目文件残留在新项目中
    set({ openFiles: [], activeFilePath: null });
  },

  closeFile: (path: string) => {
    const { openFiles, activeFilePath } = get();
    const newFiles = openFiles.filter((f) => f.path !== path);

    // 若关闭的是当前激活文件，切换到前一个（或最后一个打开的）文件
    let newActive = activeFilePath;
    if (activeFilePath === path) {
      if (newFiles.length === 0) {
        newActive = null;
      } else {
        // 找到被关闭文件的索引，切换到其前一个（若无则取第一个）
        const closedIndex = openFiles.findIndex((f) => f.path === path);
        const prevIndex = Math.max(0, closedIndex - 1);
        newActive = newFiles[Math.min(prevIndex, newFiles.length - 1)]?.path ?? null;
      }
    }

    set({ openFiles: newFiles, activeFilePath: newActive });
  },

  saveFile: async (path: string) => {
    const { openFiles } = get();
    const file = openFiles.find((f) => f.path === path);
    if (!file) return;

    // 通过 Tauri Command 写入文件
    await invoke('write_file_cmd', { path, content: file.content });

    // 更新磁盘内容快照，清除脏标记
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path
          ? { ...f, diskContent: f.content, isDirty: false }
          : f
      ),
    }));
  },

  setActive: (path: string) => {
    set({ activeFilePath: path });
  },

  closeOthers: (path: string) => {
    set((state) => {
      const target = state.openFiles.find((file) => file.path === path);
      if (!target) return state;
      return {
        openFiles: [target],
        activeFilePath: path,
      };
    });
  },

  closeLeft: (path: string) => {
    set((state) => {
      const targetIndex = state.openFiles.findIndex((file) => file.path === path);
      if (targetIndex <= 0) return state;
      return {
        openFiles: state.openFiles.slice(targetIndex),
        activeFilePath: state.activeFilePath === null ? path : state.activeFilePath,
      };
    });
  },

  closeRight: (path: string) => {
    set((state) => {
      const targetIndex = state.openFiles.findIndex((file) => file.path === path);
      if (targetIndex < 0 || targetIndex === state.openFiles.length - 1) return state;
      const nextOpenFiles = state.openFiles.slice(0, targetIndex + 1);
      const activeStillOpen = nextOpenFiles.some((file) => file.path === state.activeFilePath);
      return {
        openFiles: nextOpenFiles,
        activeFilePath: activeStillOpen ? state.activeFilePath : path,
      };
    });
  },

  updateContent: (path: string, content: string) => {
    set((state) => ({
      openFiles: state.openFiles.map((f) => {
        if (f.path !== path) return f;
        // 若内容与磁盘内容相同，isDirty 还原为 false
        const isDirty = content !== f.diskContent;
        return { ...f, content, isDirty };
      }),
    }));
  },

  /**
   * 处理文件被外部程序修改的情况
   *
   * 业务逻辑说明：
   * 1. 若文件未在 openFiles 中打开，直接忽略（无需更新）
   * 2. 重新从磁盘读取最新内容
   * 3. 若 isDirty=false（用户无未保存修改）：静默更新 content 和 diskContent
   * 4. 若 isDirty=true（用户有未保存修改）：设置 hasConflict=true，触发 ConflictDialog
   */
  handleExternalChange: async (path: string) => {
    const { openFiles } = get();
    const file = openFiles.find((f) => f.path === path);

    // 文件未在编辑器中打开，无需处理
    if (!file) return;

    // 从磁盘重新读取最新内容
    const result = await invoke<ReadFileResult>('read_file_cmd', { path });

    // 仅对 text 类型的文件做内容刷新，binary/large/error 类型直接忽略
    if (result.kind !== 'text') return;
    const newContent = result.content;

    set((state) => ({
      openFiles: state.openFiles.map((f) => {
        if (f.path !== path) return f;

        if (!f.isDirty) {
          // 用户无未保存修改：静默刷新内容（content + diskContent 同步更新）
          return { ...f, content: newContent, diskContent: newContent, hasConflict: false };
        } else {
          // 用户有未保存修改：标记冲突，由 ConflictDialog 组件处理用户决策
          return { ...f, diskContent: newContent, hasConflict: true };
        }
      }),
    }));
  },
}));
