/**
 * @file toolsStore.test.ts
 * @description toolsStore undo 栈行为测试 + active 状态切换
 * @author Atlas.oi
 * @date 2026-04-18
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

// 顶层 mock 保证动态路径被拦截
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

// store 在 mock 建立后才导入，确保内部 invoke 引用是 mock 版本
const { useToolsStore } = await import('../toolsStore');

describe('toolsStore', () => {
  beforeEach(() => {
    // 每次测试前重置 store 到初始状态，避免测试间状态污染
    useToolsStore.setState({
      activeToolId: null,
      activeTemplateId: '_builtin-gbt7714-v2',
      undoStack: [],
    });
    vi.mocked(invoke).mockReset();
  });

  // ============================================================
  // push/pop 栈顺序
  // ============================================================

  it('pushUndo 按压入顺序叠加到栈顶', () => {
    const { pushUndo } = useToolsStore.getState();

    const entryA = {
      originPath: '/proj/a.docx',
      snapshotVersion: 1,
      issueId: 'issue-1',
      timestamp: 1000,
    };
    const entryB = {
      originPath: '/proj/b.docx',
      snapshotVersion: 2,
      issueId: 'issue-2',
      timestamp: 2000,
    };

    pushUndo(entryA);
    pushUndo(entryB);

    const { undoStack } = useToolsStore.getState();
    // 栈顶是最后压入的 B
    expect(undoStack).toHaveLength(2);
    expect(undoStack[undoStack.length - 1]).toEqual(entryB);
    expect(undoStack[0]).toEqual(entryA);
  });

  // ============================================================
  // undo 弹栈顶并调用 backup_restore_cmd
  // ============================================================

  it('undo 弹出栈顶并以正确参数调用 backup_restore_cmd', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    const entry = {
      originPath: '/proj/a.docx',
      snapshotVersion: 3,
      issueId: 'issue-3',
      timestamp: 3000,
    };
    useToolsStore.setState({ undoStack: [entry] });

    await useToolsStore.getState().undo();

    // 栈已清空
    expect(useToolsStore.getState().undoStack).toHaveLength(0);

    // invoke 被以正确参数调用
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('backup_restore_cmd', {
      origin: '/proj/a.docx',
      version: 3,
    });
  });

  // ============================================================
  // 栈空时 undo 不崩
  // ============================================================

  it('undoStack 为空时调用 undo 直接返回，不调用 invoke', async () => {
    await useToolsStore.getState().undo();

    // invoke 未被调用
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
    // 栈仍然为空
    expect(useToolsStore.getState().undoStack).toHaveLength(0);
  });

  // ============================================================
  // undo 失败时栈顶必须保留，以便用户重试
  // ============================================================

  it('undo 时 invoke 失败应保留栈顶条目', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('boom'));

    const entry = {
      originPath: '/proj/a.docx',
      snapshotVersion: 5,
      issueId: 'issue-5',
      timestamp: 5000,
    };
    useToolsStore.getState().pushUndo(entry);

    // 调用应抛出，错误冒泡到调用方
    await expect(useToolsStore.getState().undo()).rejects.toThrow('boom');

    // 关键断言：栈未被弹空，用户可重试
    const { undoStack } = useToolsStore.getState();
    expect(undoStack).toHaveLength(1);
    expect(undoStack[0]).toEqual(entry);
  });

  // ============================================================
  // setActiveTool / setActiveTemplate
  // ============================================================

  it('setActiveTool 和 setActiveTemplate 更新对应字段', () => {
    const { setActiveTool, setActiveTemplate } = useToolsStore.getState();

    setActiveTool('tool-cjk-space');
    expect(useToolsStore.getState().activeToolId).toBe('tool-cjk-space');

    setActiveTool(null);
    expect(useToolsStore.getState().activeToolId).toBeNull();

    setActiveTemplate('my-custom-template');
    expect(useToolsStore.getState().activeTemplateId).toBe('my-custom-template');
  });
});
