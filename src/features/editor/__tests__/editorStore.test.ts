/**
 * @file editorStore 单元测试
 * @description 测试编辑器状态管理：openFile 按 kind 分支、closeFile、saveFile、setActive、updateContent
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

// 每个测试前重置 store 状态
// 通过重新导入模块实现（vitest 隔离模式会在每个文件重置模块）
// 这里使用工厂函数方式避免模块状态污染

describe('editorStore', () => {
  beforeEach(async () => {
    // 重置 mock 和 store 状态
    vi.clearAllMocks();
    // 重置 store：导入后直接修改内部状态
    const { useEditorStore } = await import('../editorStore');
    useEditorStore.setState({
      openFiles: [],
      activeFilePath: null,
      pendingScrollLine: {},
    });
  });

  describe('openFile', () => {
    it('text 文件：读取成功后创建 kind=text 的 OpenFile', async () => {
      vi.mocked(invoke).mockResolvedValue({
        kind: 'text',
        content: 'const x = 1;',
      });

      const { useEditorStore } = await import('../editorStore');
      await useEditorStore.getState().openFile('/project/src/main.ts');

      const state = useEditorStore.getState();
      expect(state.openFiles).toHaveLength(1);
      expect(state.openFiles[0]).toMatchObject({
        path: '/project/src/main.ts',
        content: 'const x = 1;',
        diskContent: 'const x = 1;',
        isDirty: false,
        kind: 'text',
        language: 'ts',
      });
      expect(state.activeFilePath).toBe('/project/src/main.ts');
    });

    it('binary 文件：创建 kind=binary 的 OpenFile，content 为空', async () => {
      vi.mocked(invoke).mockResolvedValue({
        kind: 'binary',
        mime_hint: 'image/png',
      });

      const { useEditorStore } = await import('../editorStore');
      await useEditorStore.getState().openFile('/assets/logo.png');

      const state = useEditorStore.getState();
      expect(state.openFiles[0]).toMatchObject({
        path: '/assets/logo.png',
        kind: 'binary',
        mimeHint: 'image/png',
        content: '',
        isDirty: false,
      });
    });

    it('large 文件：创建 kind=large 的 OpenFile', async () => {
      vi.mocked(invoke).mockResolvedValue({
        kind: 'large',
        size: 6 * 1024 * 1024,
      });

      const { useEditorStore } = await import('../editorStore');
      await useEditorStore.getState().openFile('/data/large.bin');

      const state = useEditorStore.getState();
      expect(state.openFiles[0]).toMatchObject({
        path: '/data/large.bin',
        kind: 'large',
        content: '',
      });
    });

    it('error 文件：创建 kind=error 的 OpenFile，包含错误信息', async () => {
      vi.mocked(invoke).mockResolvedValue({
        kind: 'error',
        message: 'Detected encoding: GBK. File cannot be opened as UTF-8.',
      });

      const { useEditorStore } = await import('../editorStore');
      await useEditorStore.getState().openFile('/data/chinese.txt');

      const state = useEditorStore.getState();
      expect(state.openFiles[0]).toMatchObject({
        path: '/data/chinese.txt',
        kind: 'error',
        errorMessage: 'Detected encoding: GBK. File cannot be opened as UTF-8.',
      });
    });

    it('重复打开同一文件：不重复创建，切换 active', async () => {
      vi.mocked(invoke).mockResolvedValue({
        kind: 'text',
        content: 'hello',
      });

      const { useEditorStore } = await import('../editorStore');
      await useEditorStore.getState().openFile('/src/a.ts');
      await useEditorStore.getState().openFile('/src/a.ts');

      const state = useEditorStore.getState();
      // 不应重复创建
      expect(state.openFiles).toHaveLength(1);
      expect(invoke).toHaveBeenCalledTimes(1);
    });
  });

  describe('closeFile', () => {
    it('关闭文件后从 openFiles 中移除', async () => {
      vi.mocked(invoke).mockResolvedValue({ kind: 'text', content: 'x' });

      const { useEditorStore } = await import('../editorStore');
      await useEditorStore.getState().openFile('/src/a.ts');
      useEditorStore.getState().closeFile('/src/a.ts');

      expect(useEditorStore.getState().openFiles).toHaveLength(0);
    });

    it('关闭 active 文件：activeFilePath 切换到前一个文件或 null', async () => {
      vi.mocked(invoke)
        .mockResolvedValueOnce({ kind: 'text', content: 'a' })
        .mockResolvedValueOnce({ kind: 'text', content: 'b' });

      const { useEditorStore } = await import('../editorStore');
      await useEditorStore.getState().openFile('/src/a.ts');
      await useEditorStore.getState().openFile('/src/b.ts');
      // 此时 active 为 b.ts
      useEditorStore.getState().closeFile('/src/b.ts');

      const state = useEditorStore.getState();
      expect(state.openFiles).toHaveLength(1);
      // active 应回退到 a.ts
      expect(state.activeFilePath).toBe('/src/a.ts');
    });

    it('关闭最后一个文件：activeFilePath 变为 null', async () => {
      vi.mocked(invoke).mockResolvedValue({ kind: 'text', content: 'x' });

      const { useEditorStore } = await import('../editorStore');
      await useEditorStore.getState().openFile('/src/a.ts');
      useEditorStore.getState().closeFile('/src/a.ts');

      expect(useEditorStore.getState().activeFilePath).toBeNull();
    });
  });

  describe('saveFile', () => {
    it('保存后 isDirty 变为 false，diskContent 更新', async () => {
      vi.mocked(invoke)
        .mockResolvedValueOnce({ kind: 'text', content: 'original' })
        .mockResolvedValueOnce(undefined); // write_file_cmd

      const { useEditorStore } = await import('../editorStore');
      await useEditorStore.getState().openFile('/src/a.ts');

      // 模拟用户编辑（更新内容）
      useEditorStore.getState().updateContent('/src/a.ts', 'modified content');

      // 验证 isDirty = true
      expect(useEditorStore.getState().openFiles[0].isDirty).toBe(true);

      // 保存
      await useEditorStore.getState().saveFile('/src/a.ts');

      const file = useEditorStore.getState().openFiles[0];
      expect(file.isDirty).toBe(false);
      expect(file.diskContent).toBe('modified content');
      expect(file.content).toBe('modified content');
    });
  });

  describe('setActive', () => {
    it('切换 activeFilePath', async () => {
      vi.mocked(invoke)
        .mockResolvedValueOnce({ kind: 'text', content: 'a' })
        .mockResolvedValueOnce({ kind: 'text', content: 'b' });

      const { useEditorStore } = await import('../editorStore');
      await useEditorStore.getState().openFile('/src/a.ts');
      await useEditorStore.getState().openFile('/src/b.ts');

      useEditorStore.getState().setActive('/src/a.ts');
      expect(useEditorStore.getState().activeFilePath).toBe('/src/a.ts');

      useEditorStore.getState().setActive('/src/b.ts');
      expect(useEditorStore.getState().activeFilePath).toBe('/src/b.ts');
    });
  });

  describe('handleExternalChange', () => {
    it('文件未打开时不应有任何副作用', async () => {
      const { useEditorStore } = await import('../editorStore');
      // openFiles 为空，调用 handleExternalChange 不应报错也不应改变状态
      await useEditorStore.getState().handleExternalChange('/nonexistent/file.ts');
      expect(useEditorStore.getState().openFiles).toHaveLength(0);
    });

    it('isDirty=false 时静默更新 content 和 diskContent', async () => {
      vi.mocked(invoke)
        .mockResolvedValueOnce({ kind: 'text', content: 'original' }) // openFile
        .mockResolvedValueOnce({ kind: 'text', content: 'new from disk' }); // handleExternalChange

      const { useEditorStore } = await import('../editorStore');
      await useEditorStore.getState().openFile('/src/a.ts');

      // isDirty 初始为 false（内容与磁盘相同）
      expect(useEditorStore.getState().openFiles[0].isDirty).toBe(false);

      await useEditorStore.getState().handleExternalChange('/src/a.ts');

      const file = useEditorStore.getState().openFiles[0];
      // 内容和磁盘内容均更新为新值
      expect(file.content).toBe('new from disk');
      expect(file.diskContent).toBe('new from disk');
      // 没有冲突标记
      expect(file.hasConflict).toBe(false);
    });

    it('isDirty=true 时设置 hasConflict=true', async () => {
      vi.mocked(invoke)
        .mockResolvedValueOnce({ kind: 'text', content: 'original' }) // openFile
        .mockResolvedValueOnce({ kind: 'text', content: 'new from disk' }); // handleExternalChange

      const { useEditorStore } = await import('../editorStore');
      await useEditorStore.getState().openFile('/src/a.ts');

      // 用户编辑了内容，isDirty=true
      useEditorStore.getState().updateContent('/src/a.ts', 'user edits');
      expect(useEditorStore.getState().openFiles[0].isDirty).toBe(true);

      await useEditorStore.getState().handleExternalChange('/src/a.ts');

      const file = useEditorStore.getState().openFiles[0];
      // 编辑器内容保留用户修改
      expect(file.content).toBe('user edits');
      // 冲突标记设置
      expect(file.hasConflict).toBe(true);
    });

    it('非 text 类型文件（binary）不更新内容', async () => {
      vi.mocked(invoke)
        .mockResolvedValueOnce({ kind: 'binary', mime_hint: 'image/png' }) // openFile
        .mockResolvedValueOnce({ kind: 'binary', mime_hint: 'image/png' }); // handleExternalChange

      const { useEditorStore } = await import('../editorStore');
      await useEditorStore.getState().openFile('/assets/logo.png');

      const beforeCall = useEditorStore.getState().openFiles[0];
      await useEditorStore.getState().handleExternalChange('/assets/logo.png');

      // binary 文件不做任何更新
      const afterCall = useEditorStore.getState().openFiles[0];
      expect(afterCall).toStrictEqual(beforeCall);
    });
  });

  describe('openFile with line number', () => {
    it('新文件打开时设置 pendingScrollLine', async () => {
      vi.mocked(invoke).mockResolvedValue({ kind: 'text', content: 'const x = 1;' });

      const { useEditorStore } = await import('../editorStore');
      await useEditorStore.getState().openFile('/project/src/main.ts', 5);

      const state = useEditorStore.getState();
      expect(state.pendingScrollLine['/project/src/main.ts']).toBe(5);
    });

    it('已打开文件切换激活时设置 pendingScrollLine', async () => {
      vi.mocked(invoke).mockResolvedValue({ kind: 'text', content: 'hello' });

      const { useEditorStore } = await import('../editorStore');
      // 先打开，使文件进入 openFiles（非占位）
      await useEditorStore.getState().openFile('/src/a.ts');
      // 再次打开同路径并带行号
      await useEditorStore.getState().openFile('/src/a.ts', 10);

      const state = useEditorStore.getState();
      // openFiles 不重复，但 pendingScrollLine 已写入
      expect(state.openFiles).toHaveLength(1);
      expect(state.pendingScrollLine['/src/a.ts']).toBe(10);
    });

    it('clearPendingScroll 删除对应条目', async () => {
      vi.mocked(invoke).mockResolvedValue({ kind: 'text', content: 'x' });

      const { useEditorStore } = await import('../editorStore');
      await useEditorStore.getState().openFile('/src/a.ts', 3);
      // 确认写入
      expect(useEditorStore.getState().pendingScrollLine['/src/a.ts']).toBe(3);

      // Editor 滚动完成后调用清除
      useEditorStore.getState().clearPendingScroll('/src/a.ts');

      // key 应被删除
      expect(useEditorStore.getState().pendingScrollLine['/src/a.ts']).toBeUndefined();
    });

    it('不传 lineNumber 时不设置 pendingScrollLine', async () => {
      vi.mocked(invoke).mockResolvedValue({ kind: 'text', content: 'x' });

      const { useEditorStore } = await import('../editorStore');
      await useEditorStore.getState().openFile('/src/a.ts');

      expect(useEditorStore.getState().pendingScrollLine).toEqual({});
    });
  });

  describe('updateContent', () => {
    it('更新内容后 isDirty 变为 true', async () => {
      vi.mocked(invoke).mockResolvedValue({ kind: 'text', content: 'original' });

      const { useEditorStore } = await import('../editorStore');
      await useEditorStore.getState().openFile('/src/a.ts');

      useEditorStore.getState().updateContent('/src/a.ts', 'new content');

      const file = useEditorStore.getState().openFiles[0];
      expect(file.content).toBe('new content');
      expect(file.isDirty).toBe(true);
    });

    it('内容与 diskContent 相同时 isDirty 变为 false', async () => {
      vi.mocked(invoke).mockResolvedValue({ kind: 'text', content: 'original' });

      const { useEditorStore } = await import('../editorStore');
      await useEditorStore.getState().openFile('/src/a.ts');

      // 先修改，再还原
      useEditorStore.getState().updateContent('/src/a.ts', 'changed');
      useEditorStore.getState().updateContent('/src/a.ts', 'original');

      expect(useEditorStore.getState().openFiles[0].isDirty).toBe(false);
    });
  });

  // ============================================
  // 持久化回归测试（Bug 2 修复）
  //
  // 业务背景：
  // 旧版 closeFile / setActive 等只改内存，不触发 save_editor_session_cmd，
  // 用户在不切项目的情况下关闭文件并直接退出 GhostTerm，
  // 重启后 editor_sessions.json 仍是上次切项目时的快照 → 关闭过的文件复活。
  //
  // 修复后：close 系列 / openFile / setActive 末尾调用 syncCurrentSession，
  // 通过 lazy import projectStore 拿 currentPath，触发 save_editor_session_cmd。
  // ============================================
  describe('syncCurrentSession 触发持久化', () => {
    beforeEach(async () => {
      // 测试持久化必须有当前项目，初始化 projectStore.currentProject
      const { useProjectStore } = await import('../../sidebar/projectStore');
      useProjectStore.setState({
        currentProject: { path: '/proj-x', name: 'proj-x', last_opened: 0 } as never,
        recentProjects: [],
      });
    });

    it('closeFile 后调用 save_editor_session_cmd 持久化新状态', async () => {
      // openFile + closeFile 会经历：read_file_cmd → save_editor_session_cmd × 2
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'read_file_cmd') return { kind: 'text', content: 'x' };
        if (cmd === 'save_editor_session_cmd') return undefined;
        return undefined;
      });

      const { useEditorStore } = await import('../editorStore');
      await useEditorStore.getState().openFile('/proj-x/a.ts');
      // openFile 触发一次 sync
      // closeFile 应再次触发持久化
      useEditorStore.getState().closeFile('/proj-x/a.ts');
      // 等待 fire-and-forget 持久化完成
      await new Promise((resolve) => setTimeout(resolve, 0));

      const calls = vi.mocked(invoke).mock.calls.filter(
        ([cmd]) => cmd === 'save_editor_session_cmd'
      );
      // openFile + closeFile 各触发一次，共两次
      expect(calls.length).toBeGreaterThanOrEqual(2);
      // 最后一次持久化体现关闭后的状态：openFilePaths 为空
      const lastPayload = calls[calls.length - 1][1] as {
        projectPath: string;
        openFilePaths: string[];
        activeFilePath: string | null;
      };
      expect(lastPayload.projectPath).toBe('/proj-x');
      expect(lastPayload.openFilePaths).toEqual([]);
      expect(lastPayload.activeFilePath).toBeNull();
    });

    it('setActive 后调用 save_editor_session_cmd 持久化新激活路径', async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'read_file_cmd') return { kind: 'text', content: 'x' };
        if (cmd === 'save_editor_session_cmd') return undefined;
        return undefined;
      });

      const { useEditorStore } = await import('../editorStore');
      await useEditorStore.getState().openFile('/proj-x/a.ts');
      await useEditorStore.getState().openFile('/proj-x/b.ts');
      // 等待 openFile 内的 fire-and-forget syncCurrentSession 异步完成，
      // 避免之后 mockClear 之后才到达的 save 污染调用计数
      await new Promise((resolve) => setTimeout(resolve, 0));

      vi.mocked(invoke).mockClear();
      useEditorStore.getState().setActive('/proj-x/a.ts');
      await new Promise((resolve) => setTimeout(resolve, 0));

      const calls = vi.mocked(invoke).mock.calls.filter(
        ([cmd]) => cmd === 'save_editor_session_cmd'
      );
      expect(calls.length).toBe(1);
      const payload = calls[0][1] as { activeFilePath: string | null };
      expect(payload.activeFilePath).toBe('/proj-x/a.ts');
    });

    it('无 currentProject 时 syncCurrentSession 静默跳过，不触发 invoke', async () => {
      // 重置 projectStore 至无项目状态
      const { useProjectStore } = await import('../../sidebar/projectStore');
      useProjectStore.setState({
        currentProject: null,
        recentProjects: [],
      });

      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'read_file_cmd') return { kind: 'text', content: 'x' };
        return undefined;
      });

      const { useEditorStore } = await import('../editorStore');
      await useEditorStore.getState().openFile('/orphan/a.ts');
      await new Promise((resolve) => setTimeout(resolve, 0));

      const saveCalls = vi.mocked(invoke).mock.calls.filter(
        ([cmd]) => cmd === 'save_editor_session_cmd'
      );
      expect(saveCalls).toHaveLength(0);
    });
  });
});
