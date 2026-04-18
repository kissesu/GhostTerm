/**
 * @file toolsStore.ts
 * @description 工具面板全局状态管理。
 *              管理当前激活的工具 ID、模板 ID，以及对文件修改的 undo 栈。
 *              undo 栈弹顶后调用 Rust backup_restore_cmd 还原文件快照。
 * @author Atlas.oi
 * @date 2026-04-18
 */

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

/**
 * Undo 栈条目。
 * 存储"哪个文件"的"哪个快照版本"被应用，以便 undo 时能正确还原。
 *
 * 注意：plan 原始 schema 写的是 fileHash，但 backup_restore_cmd 签名接受
 * origin (路径字符串)，fileHash 在语义上和调用约定上均不匹配，
 * 因此改为 originPath。详见 self-review 中的 spec 偏差说明。
 */
export interface UndoEntry {
  /** 文件绝对路径，对应 backup_restore_cmd 的 origin 参数 */
  originPath: string;
  /** 快照版本号，对应 backup_restore_cmd 的 version 参数 */
  snapshotVersion: number;
  /** 关联的 issue ID，用于 UI 展示 undo 历史 */
  issueId: string;
  /** 压栈时的时间戳（ms），用于 UI 展示 */
  timestamp: number;
}

/** toolsStore 完整状态和 Action 接口 */
interface ToolsState {
  /** 当前激活的工具 ID，null 表示无选中（ToolBoxGrid 显示卡片入口） */
  activeToolId: string | null;
  /** 当前激活的参考文献模板 ID，默认使用内置 GB/T 7714 模板 */
  activeTemplateId: string;
  /** 修改历史栈，栈顶是最近一次修改，undo 从栈顶弹出 */
  undoStack: UndoEntry[];

  // Actions
  pushUndo(entry: UndoEntry): void;
  undo(): Promise<void>;
  setActiveTool(id: string | null): void;
  setActiveTemplate(id: string): void;
}

export const useToolsStore = create<ToolsState>((set, get) => ({
  // ============================================================
  // 初始状态
  // ============================================================

  activeToolId: null,
  // _builtin-gbt7714：内置 GB/T 7714 参考文献格式模板（见 Task 8 selector 说明）
  activeTemplateId: '_builtin-gbt7714',
  undoStack: [],

  // ============================================================
  // Actions
  // ============================================================

  /**
   * 将一条 undo 记录压入栈顶
   */
  pushUndo: (entry) => {
    set((state) => ({ undoStack: [...state.undoStack, entry] }));
  },

  /**
   * 撤销最近一次修改
   *
   * 业务逻辑：
   * 1. 栈空时直接返回，不调用 invoke（幂等安全）
   * 2. 先调用 Rust backup_restore_cmd 还原文件快照
   * 3. 还原成功后才弹出栈顶；失败时让错误冒泡，栈保留以便用户重试
   *
   * 注意：顺序关键。若先弹栈再 invoke，invoke 失败时栈顶条目永久丢失，
   * 用户将无法再次尝试 undo。
   */
  undo: async () => {
    const { undoStack } = get();
    if (undoStack.length === 0) return;

    const top = undoStack[undoStack.length - 1];
    await invoke('backup_restore_cmd', {
      origin: top.originPath,
      version: top.snapshotVersion,
    });

    // invoke 成功后才弹栈，重新读取最新栈避免并发 push 被覆盖
    set((state) => ({ undoStack: state.undoStack.slice(0, -1) }));
  },

  /**
   * 切换激活工具，null 表示回到工具卡片入口视图
   */
  setActiveTool: (id) => {
    set({ activeToolId: id });
  },

  /**
   * 切换参考文献模板
   */
  setActiveTemplate: (id) => {
    set({ activeTemplateId: id });
  },
}));
