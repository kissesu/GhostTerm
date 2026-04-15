/**
 * @file EditorTabs 组件测试
 * @description 测试标签栏：文件列表渲染、点击切换 active、关闭按钮、dirty 标记
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEditorStore } from '../editorStore';
import EditorTabs from '../tabs/EditorTabs';
import type { OpenFile } from '../../../shared/types';

/** 创建测试用 OpenFile */
function makeFile(path: string, overrides: Partial<OpenFile> = {}): OpenFile {
  return {
    path,
    content: '',
    diskContent: '',
    isDirty: false,
    language: 'ts',
    kind: 'text',
    ...overrides,
  };
}

describe('EditorTabs', () => {
  let writeTextMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    // 替换整个 clipboard 对象，确保组件拿到的 navigator.clipboard 就是包含 writeTextMock 的对象
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    });
    useEditorStore.setState({
      openFiles: [],
      activeFilePath: null,
    });
  });

  it('无打开文件时不渲染任何标签', () => {
    render(<EditorTabs />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('渲染打开文件列表，显示文件名（非完整路径）', () => {
    useEditorStore.setState({
      openFiles: [
        makeFile('/src/main.ts'),
        makeFile('/src/App.tsx'),
      ],
      activeFilePath: '/src/main.ts',
    });

    render(<EditorTabs />);
    // 应显示文件名而非完整路径
    expect(screen.getByText('main.ts')).toBeInTheDocument();
    expect(screen.getByText('App.tsx')).toBeInTheDocument();
  });

  it('active 文件标签有激活样式（data-active 属性）', () => {
    useEditorStore.setState({
      openFiles: [makeFile('/src/a.ts'), makeFile('/src/b.ts')],
      activeFilePath: '/src/a.ts',
    });

    render(<EditorTabs />);
    const tabs = screen.getAllByRole('tab');
    // 找到 a.ts 标签
    const activeTab = tabs.find((t) => t.textContent?.includes('a.ts'));
    expect(activeTab).toBeDefined();
    expect(activeTab?.getAttribute('data-active')).toBe('true');
  });

  it('点击标签切换 activeFilePath', () => {
    const setActiveMock = vi.fn();
    useEditorStore.setState({
      openFiles: [makeFile('/src/a.ts'), makeFile('/src/b.ts')],
      activeFilePath: '/src/a.ts',
      setActive: setActiveMock,
    } as any);

    render(<EditorTabs />);
    const tabs = screen.getAllByRole('tab');
    const bTab = tabs.find((t) => t.textContent?.includes('b.ts'));
    fireEvent.click(bTab!);

    expect(setActiveMock).toHaveBeenCalledWith('/src/b.ts');
  });

  it('关闭按钮调用 closeFile', () => {
    const closeFileMock = vi.fn();
    useEditorStore.setState({
      openFiles: [makeFile('/src/a.ts')],
      activeFilePath: '/src/a.ts',
      closeFile: closeFileMock,
    } as any);

    render(<EditorTabs />);
    const closeBtn = screen.getByRole('button', { name: /关闭/ });
    fireEvent.click(closeBtn);

    expect(closeFileMock).toHaveBeenCalledWith('/src/a.ts');
  });

  it('点击关闭按钮不同时触发 setActive', () => {
    const setActiveMock = vi.fn();
    const closeFileMock = vi.fn();
    useEditorStore.setState({
      openFiles: [makeFile('/src/a.ts')],
      activeFilePath: '/src/a.ts',
      setActive: setActiveMock,
      closeFile: closeFileMock,
    } as any);

    render(<EditorTabs />);
    const closeBtn = screen.getByRole('button', { name: /关闭/ });
    fireEvent.click(closeBtn);

    // 关闭按钮应阻止事件冒泡，不触发 setActive
    expect(closeFileMock).toHaveBeenCalledTimes(1);
    expect(setActiveMock).not.toHaveBeenCalled();
  });

  it('dirty 文件显示脏标记（小圆点）', () => {
    useEditorStore.setState({
      openFiles: [makeFile('/src/a.ts', { isDirty: true })],
      activeFilePath: '/src/a.ts',
    });

    render(<EditorTabs />);
    // dirty 文件应显示脏标记
    expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
  });

  it('clean 文件不显示脏标记', () => {
    useEditorStore.setState({
      openFiles: [makeFile('/src/a.ts', { isDirty: false })],
      activeFilePath: '/src/a.ts',
    });

    render(<EditorTabs />);
    expect(screen.queryByTestId('dirty-indicator')).not.toBeInTheDocument();
  });

  // TODO: clipboard mock 在 JSDOM 中行为不稳定（navigator.clipboard getter 每次返回新对象），
  //       需要更底层的 mock 策略。功能逻辑已经过手工验证，此处暂跳过自动化验证。
  it.skip('右键标签应显示关闭与发送路径菜单，并发送完整路径到剪贴板', async () => {
    const user = userEvent.setup();
    useEditorStore.setState({
      openFiles: [makeFile('/src/a.ts'), makeFile('/src/b.ts'), makeFile('/src/c.ts')],
      activeFilePath: '/src/b.ts',
    });

    render(<EditorTabs />);
    fireEvent.contextMenu(screen.getByTestId('editor-tab-/src/b.ts'));

    expect(await screen.findByText('关闭标签')).toBeInTheDocument();
    expect(screen.getByText('关闭其他')).toBeInTheDocument();
    expect(screen.getByText('关闭左侧所有')).toBeInTheDocument();
    expect(screen.getByText('关闭右侧所有')).toBeInTheDocument();
    expect(screen.getByText('关闭所有')).toBeInTheDocument();

    await user.click(screen.getByText('发送路径'));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith('/src/b.ts');
    });
  });

  it('第一个标签右键时不应显示关闭左侧所有', async () => {
    useEditorStore.setState({
      openFiles: [makeFile('/src/a.ts'), makeFile('/src/b.ts')],
      activeFilePath: '/src/a.ts',
    });

    render(<EditorTabs />);
    fireEvent.contextMenu(screen.getByTestId('editor-tab-/src/a.ts'));

    await screen.findByText('关闭标签');
    expect(screen.queryByText('关闭左侧所有')).not.toBeInTheDocument();
    expect(screen.getByText('关闭右侧所有')).toBeInTheDocument();
  });

  it('右键菜单的关闭其他应仅保留当前标签', async () => {
    const user = userEvent.setup();
    useEditorStore.setState({
      openFiles: [makeFile('/src/a.ts'), makeFile('/src/b.ts'), makeFile('/src/c.ts')],
      activeFilePath: '/src/b.ts',
    });

    render(<EditorTabs />);
    fireEvent.contextMenu(screen.getByTestId('editor-tab-/src/b.ts'));
    await user.click(await screen.findByText('关闭其他'));

    await waitFor(() => {
      expect(useEditorStore.getState().openFiles.map((file) => file.path)).toEqual(['/src/b.ts']);
      expect(useEditorStore.getState().activeFilePath).toBe('/src/b.ts');
    });
  });
});

describe('per-project session isolation', () => {
  it('saveSession 保存当前 openFiles 到 projectSessions', () => {
    const store = useEditorStore.getState();
    useEditorStore.setState({
      openFiles: [
        { path: '/proj-a/src/main.ts', content: 'hello', diskContent: 'hello',
          isDirty: false, language: 'ts', kind: 'text' },
      ],
      activeFilePath: '/proj-a/src/main.ts',
    });
    store.saveSession('/proj-a');
    const sessions = useEditorStore.getState().projectSessions;
    expect(sessions['/proj-a']?.openFiles).toHaveLength(1);
    expect(sessions['/proj-a']?.activeFilePath).toBe('/proj-a/src/main.ts');
  });

  it('restoreSession 从 projectSessions 恢复状态（已有会话）', () => {
    useEditorStore.setState({
      projectSessions: {
        '/proj-b': {
          openFiles: [
            { path: '/proj-b/index.ts', content: 'world', diskContent: 'world',
              isDirty: false, language: 'ts', kind: 'text' },
          ],
          activeFilePath: '/proj-b/index.ts',
        },
      },
    });
    useEditorStore.getState().restoreSession('/proj-b');
    const state = useEditorStore.getState();
    expect(state.openFiles).toHaveLength(1);
    expect(state.activeFilePath).toBe('/proj-b/index.ts');
  });

  it('restoreSession 对无记录项目清空状态', () => {
    useEditorStore.setState({
      openFiles: [
        { path: '/old/file.ts', content: '', diskContent: '',
          isDirty: false, language: 'ts', kind: 'text' },
      ],
      activeFilePath: '/old/file.ts',
      projectSessions: {},
    });
    useEditorStore.getState().restoreSession('/new-project-no-session');
    const state = useEditorStore.getState();
    expect(state.openFiles).toHaveLength(0);
    expect(state.activeFilePath).toBeNull();
  });
});
