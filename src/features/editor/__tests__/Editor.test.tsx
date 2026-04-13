/**
 * @file Editor 组件测试
 * @description 测试 CodeMirror 6 编辑器渲染：文本内容显示、binary/large/error 占位符、
 *              主题同步、Cmd+S 保存快捷键
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useEditorStore } from '../editorStore';
import Editor from '../Editor';

// CodeMirror 在 jsdom 环境下无法完整渲染，mock 关键模块
// vi.hoisted 确保 mock 变量在 vi.mock 内可用（vi.mock 会被 hoisted 到文件顶部）
const { EditorViewMock } = vi.hoisted(() => {
  const mockFn = vi.fn().mockImplementation(({ parent }: { parent?: HTMLElement }) => {
    const div = document.createElement('div');
    div.className = 'cm-editor';
    if (parent) parent.appendChild(div);
    return { destroy: vi.fn(), dispatch: vi.fn(), dom: div };
  }) as any;
  mockFn.updateListener = { of: vi.fn().mockReturnValue([]) };
  mockFn.theme = vi.fn().mockReturnValue([]);
  mockFn.editable = { of: vi.fn().mockReturnValue([]) };
  return { EditorViewMock: mockFn };
});

vi.mock('@codemirror/view', () => ({
  EditorView: EditorViewMock,
  keymap: vi.fn().mockReturnValue([]),
}));

vi.mock('codemirror', () => ({
  basicSetup: [],
}));

vi.mock('@codemirror/state', () => ({
  EditorState: {
    create: vi.fn().mockReturnValue({ doc: { toString: () => '' } }),
  },
  Compartment: vi.fn().mockImplementation(() => ({
    of: vi.fn().mockReturnValue([]),
    reconfigure: vi.fn().mockReturnValue({}),
  })),
}));

vi.mock('@codemirror/theme-one-dark', () => ({
  oneDark: [],
}));

vi.mock('@codemirror/lang-javascript', () => ({
  javascript: vi.fn().mockReturnValue([]),
}));

vi.mock('@codemirror/lang-rust', () => ({
  rust: vi.fn().mockReturnValue([]),
}));

vi.mock('@codemirror/lang-json', () => ({
  json: vi.fn().mockReturnValue([]),
}));

vi.mock('@codemirror/lang-html', () => ({
  html: vi.fn().mockReturnValue([]),
}));

vi.mock('@codemirror/lang-css', () => ({
  css: vi.fn().mockReturnValue([]),
}));

vi.mock('@codemirror/lang-python', () => ({
  python: vi.fn().mockReturnValue([]),
}));

vi.mock('@codemirror/commands', () => ({
  defaultKeymap: [],
  historyKeymap: [],
  indentWithTab: {},
}));

vi.mock('@codemirror/language', () => ({
  syntaxHighlighting: vi.fn().mockReturnValue([]),
  defaultHighlightStyle: [],
  StreamLanguage: { define: vi.fn() },
}));

describe('Editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.setState({
      openFiles: [],
      activeFilePath: null,
    });
  });

  it('无激活文件时显示空白占位符', () => {
    render(<Editor />);
    // 无 active 文件时应渲染欢迎/空白状态
    expect(screen.getByTestId('editor-empty')).toBeInTheDocument();
  });

  it('text 文件：渲染 CodeMirror 编辑器容器', async () => {
    useEditorStore.setState({
      openFiles: [{
        path: '/src/main.ts',
        content: 'const x = 1;',
        diskContent: 'const x = 1;',
        isDirty: false,
        language: 'ts',
        kind: 'text',
      }],
      activeFilePath: '/src/main.ts',
    });

    render(<Editor />);

    // 应渲染编辑器容器
    await waitFor(() => {
      expect(screen.getByTestId('editor-container')).toBeInTheDocument();
    });
  });

  it('binary 文件：显示二进制占位符文字', () => {
    useEditorStore.setState({
      openFiles: [{
        path: '/assets/logo.png',
        content: '',
        diskContent: '',
        isDirty: false,
        language: 'png',
        kind: 'binary',
        mimeHint: 'image/png',
      }],
      activeFilePath: '/assets/logo.png',
    });

    render(<Editor />);
    expect(screen.getByTestId('editor-binary')).toBeInTheDocument();
    expect(screen.getByText(/二进制文件，无法编辑/)).toBeInTheDocument();
  });

  it('large 文件：显示只读大文件提示', () => {
    useEditorStore.setState({
      openFiles: [{
        path: '/data/large.bin',
        content: '',
        diskContent: '',
        isDirty: false,
        language: 'bin',
        kind: 'large',
      }],
      activeFilePath: '/data/large.bin',
    });

    render(<Editor />);
    expect(screen.getByTestId('editor-large')).toBeInTheDocument();
    expect(screen.getByText(/文件过大/)).toBeInTheDocument();
  });

  it('error 文件（含编码提示）：显示错误状态和"以只读模式打开"选项', () => {
    useEditorStore.setState({
      openFiles: [{
        path: '/data/chinese.txt',
        content: '',
        diskContent: '',
        isDirty: false,
        language: 'txt',
        kind: 'error',
        errorMessage: 'Detected encoding: GBK. File cannot be opened as UTF-8.',
      }],
      activeFilePath: '/data/chinese.txt',
    });

    render(<Editor />);
    expect(screen.getByTestId('editor-error')).toBeInTheDocument();
    // 含编码信息的错误应显示"以只读模式打开"选项
    expect(screen.getByText(/Detected encoding/)).toBeInTheDocument();
    expect(screen.getByText(/以只读模式打开/)).toBeInTheDocument();
  });

  it('error 文件（普通错误）：只显示错误信息，无只读选项', () => {
    useEditorStore.setState({
      openFiles: [{
        path: '/data/noperm.txt',
        content: '',
        diskContent: '',
        isDirty: false,
        language: 'txt',
        kind: 'error',
        errorMessage: '无法读取文件 /data/noperm.txt: Permission denied',
      }],
      activeFilePath: '/data/noperm.txt',
    });

    render(<Editor />);
    expect(screen.getByTestId('editor-error')).toBeInTheDocument();
    expect(screen.queryByText(/以只读模式打开/)).not.toBeInTheDocument();
  });

  it('Cmd+S 触发 saveFile', async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockResolvedValue(undefined);

    useEditorStore.setState({
      openFiles: [{
        path: '/src/main.ts',
        content: 'const x = 1;',
        diskContent: 'original',
        isDirty: true,
        language: 'ts',
        kind: 'text',
      }],
      activeFilePath: '/src/main.ts',
      saveFile: saveMock,
    } as any);

    render(<Editor />);

    // 触发 Cmd+S
    fireEvent.keyDown(document, { key: 's', metaKey: true });

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith('/src/main.ts');
    });
  });

  it('Ctrl+S 触发 saveFile（Windows/Linux 风格）', async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined);

    useEditorStore.setState({
      openFiles: [{
        path: '/src/main.ts',
        content: 'const x = 1;',
        diskContent: 'original',
        isDirty: true,
        language: 'ts',
        kind: 'text',
      }],
      activeFilePath: '/src/main.ts',
      saveFile: saveMock,
    } as any);

    render(<Editor />);

    fireEvent.keyDown(document, { key: 's', ctrlKey: true });

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith('/src/main.ts');
    });
  });
});
