/**
 * @file FileTree.test.tsx
 * @description FileTree 组件测试 - 验证目录树渲染、点击行为和对话框化右键操作
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import FileTree from '../FileTree';
import { useFileTreeStore } from '../fileTreeStore';
import { useProjectStore } from '../projectStore';
import { useEditorStore } from '../../editor/editorStore';
import type { FileNode } from '../../../shared/types';

// Mock Tauri event listen (useFsEvents 内部调用)；返回空 unlisten
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

const mockInvoke = vi.mocked(invoke);
const mockRevealItemInDir = vi.mocked(revealItemInDir);

const refreshFileTreeMock = vi.fn().mockResolvedValue(undefined);
const applyFsEventMock = vi.fn();

const sampleTree: FileNode[] = [
  {
    entry: { name: 'src', path: '/proj/src', is_dir: true, size: undefined, modified: undefined },
    children: undefined,
  },
  {
    entry: { name: 'README.md', path: '/proj/README.md', is_dir: false, size: 100, modified: undefined },
    children: null,
  },
];

const srcChildren: FileNode[] = [
  {
    entry: { name: 'main.rs', path: '/proj/src/main.rs', is_dir: false, size: 200, modified: undefined },
    children: null,
  },
];

beforeEach(() => {
  Object.defineProperty(globalThis.navigator.clipboard, 'writeText', {
    value: vi.fn().mockResolvedValue(undefined),
    configurable: true,
  });

  useFileTreeStore.setState({
    tree: [],
    expandedPaths: new Set(),
    refreshFileTree: refreshFileTreeMock,
    applyFsEvent: applyFsEventMock,
  });
  useProjectStore.setState({
    currentProject: { name: 'proj', path: '/proj', last_opened: 1 },
    recentProjects: [],
  });
  useEditorStore.setState({
    openFiles: [],
    activeFilePath: null,
  });
  refreshFileTreeMock.mockClear();
  applyFsEventMock.mockClear();
  mockRevealItemInDir.mockClear();
  vi.clearAllMocks();
});

describe('FileTree - 空树状态', () => {
  it('树为空时应显示提示文字', () => {
    render(<FileTree />);
    expect(screen.getByTestId('file-tree-empty')).toBeInTheDocument();
  });
});

describe('FileTree - 树渲染', () => {
  beforeEach(() => {
    useFileTreeStore.setState({ tree: sampleTree, expandedPaths: new Set() });
  });

  it('应渲染根节点列表', () => {
    render(<FileTree />);
    expect(screen.getByTestId('tree-node-src')).toBeInTheDocument();
    expect(screen.getByTestId('tree-node-README.md')).toBeInTheDocument();
  });

  it('应存在文件树容器（role=tree）', () => {
    render(<FileTree />);
    expect(screen.getByRole('tree')).toBeInTheDocument();
  });
});

describe('FileTree - 点击文件', () => {
  beforeEach(() => {
    useFileTreeStore.setState({ tree: sampleTree, expandedPaths: new Set() });
  });

  it('点击文件应调用 read_file_cmd', async () => {
    mockInvoke.mockResolvedValueOnce({ kind: 'text', content: 'hello' });

    render(<FileTree />);
    fireEvent.click(screen.getByTestId('tree-node-README.md'));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('read_file_cmd', {
        path: '/proj/README.md',
      });
    });
  });

  it('激活文件应带有活跃态标记，便于视觉高亮', () => {
    useEditorStore.setState({ activeFilePath: '/proj/README.md' });

    render(<FileTree />);

    expect(screen.getByTestId('tree-node-README.md')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('tree-node-src')).toHaveAttribute('data-active', 'false');
  });
});

describe('FileTree - 点击目录（展开/折叠）', () => {
  beforeEach(() => {
    useFileTreeStore.setState({ tree: sampleTree, expandedPaths: new Set() });
  });

  it('点击目录应调用 list_dir_cmd 懒加载', async () => {
    mockInvoke.mockResolvedValueOnce([srcChildren[0].entry]);

    render(<FileTree />);
    fireEvent.click(screen.getByTestId('tree-node-src'));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('list_dir_cmd', {
        path: '/proj/src',
        showHidden: false,
      });
    });
  });

  it('展开目录后子节点应可见', async () => {
    useFileTreeStore.setState({
      tree: [
        {
          entry: { name: 'src', path: '/proj/src', is_dir: true, size: undefined, modified: undefined },
          children: srcChildren,
        },
      ],
      expandedPaths: new Set(['/proj/src']),
    });

    render(<FileTree />);
    expect(screen.getByTestId('tree-node-main.rs')).toBeInTheDocument();
  });
});

describe('FileTree - 右键菜单对话框', () => {
  beforeEach(() => {
    useFileTreeStore.setState({ tree: sampleTree, expandedPaths: new Set() });
  });

  it('节点应包含 ContextMenuTrigger 包装（data-path 属性存在）', () => {
    render(<FileTree />);
    const node = screen.getByTestId('tree-node-README.md');
    expect(node).toHaveAttribute('data-path', '/proj/README.md');
  });

  it('任何节点右键菜单都应包含完整操作（新建文件/夹、在 Finder 显示、复制、剪切、重命名、删除）', async () => {
    // VS Code 对齐：文件节点也应允许新建（target=父目录），解决"项目根目录无新建入口"
    render(<FileTree />);

    fireEvent.contextMenu(screen.getByTestId('tree-node-src'));
    expect(await screen.findByText('新建文件')).toBeInTheDocument();
    expect(screen.getByText('新建文件夹')).toBeInTheDocument();
    expect(screen.getByText('在 Finder 中显示')).toBeInTheDocument();
    expect(screen.getByText('复制')).toBeInTheDocument();
    expect(screen.getByText('剪切')).toBeInTheDocument();
    expect(screen.getByText('复制路径')).toBeInTheDocument();
    expect(screen.getByText('发送路径')).toBeInTheDocument();
    expect(screen.getByText('发送相对路径')).toBeInTheDocument();
    expect(screen.getByText('重命名')).toBeInTheDocument();
    expect(screen.getByText('删除')).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByTestId('tree-node-README.md'));
    const fileMenuItems = await screen.findAllByText('在 Finder 中显示');
    const fileMenu = fileMenuItems[fileMenuItems.length - 1];
    const openMenu = fileMenu.closest('[data-state="open"]');
    // 修复后：文件节点菜单也包含新建（target = 父目录）
    expect(openMenu?.textContent).toContain('新建文件');
    expect(openMenu?.textContent).toContain('新建文件夹');
    expect(openMenu?.textContent).toContain('复制');
    expect(openMenu?.textContent).toContain('剪切');
    expect(openMenu?.textContent).toContain('复制路径');
    expect(openMenu?.textContent).toContain('发送路径');
    expect(openMenu?.textContent).toContain('发送相对路径');
  });

  it('在文件节点右键新建文件 → target 为该文件的父目录（解决项目根新建入口问题）', async () => {
    const user = userEvent.setup();
    const mockInvoke = vi.mocked((await import('@tauri-apps/api/core')).invoke);
    mockInvoke.mockResolvedValueOnce(undefined);

    render(<FileTree />);

    // 在根级文件 README.md 上右键
    fireEvent.contextMenu(screen.getByTestId('tree-node-README.md'));
    await user.click(await screen.findByTestId('ctx-new-file'));

    // 弹窗描述应表明 target 为 README.md 的父目录（即项目根 /proj）
    const dialog = await screen.findByTestId('file-tree-create-dialog');
    expect(dialog.textContent).toContain('/proj');
    expect(dialog.textContent).not.toContain('/proj/README.md');
  });

  it('文件右键菜单的在 Finder 中显示应调用 revealItemInDir（系统文件管理器高亮文件，跨平台）', async () => {
    const user = userEvent.setup();
    render(<FileTree />);

    fireEvent.contextMenu(screen.getByTestId('tree-node-README.md'));
    await user.click(await screen.findByText('在 Finder 中显示'));

    await waitFor(() => {
      // revealItemInDir：macOS Finder 高亮、Windows explorer.exe /select、Linux 父目录
      // 与 openPath（"用默认应用打开"）语义不同，回归保护此 bug
      expect(mockRevealItemInDir).toHaveBeenCalledWith('/proj/README.md');
    });
  });

  it('文件右键菜单的复制路径应写入剪贴板', async () => {
    const user = userEvent.setup();
    render(<FileTree />);

    fireEvent.contextMenu(screen.getByTestId('tree-node-README.md'));
    await user.click(await screen.findByText('复制路径'));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('/proj/README.md');
    });
  });

  it('文件夹右键菜单的发送相对路径应 dispatch ghostterm:terminal-input 事件', async () => {
    const user = userEvent.setup();
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    render(<FileTree />);

    fireEvent.contextMenu(screen.getByTestId('tree-node-src'));
    await user.click(await screen.findByText('发送相对路径'));

    await waitFor(() => {
      const dispatched = dispatchSpy.mock.calls.some(
        ([e]) => e instanceof CustomEvent && e.type === 'ghostterm:terminal-input' && e.detail === 'src',
      );
      expect(dispatched).toBe(true);
    });

    dispatchSpy.mockRestore();
  });

  it('新建文件应通过对话框调用 create_entry_cmd', async () => {
    const user = userEvent.setup();
    render(<FileTree />);

    fireEvent.contextMenu(screen.getByTestId('tree-node-src'));
    await user.click(await screen.findByTestId('ctx-new-file'));
    await user.type(screen.getByTestId('file-tree-create-input'), 'new.txt');
    await user.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('create_entry_cmd', {
        path: '/proj/src/new.txt',
        isDir: false,
      });
    });

    expect(applyFsEventMock).toHaveBeenCalledWith({
      type: 'created',
      path: '/proj/src/new.txt',
    });
    expect(screen.queryByTestId('file-tree-create-dialog')).not.toBeInTheDocument();
  });

  it('重命名应通过对话框调用 rename_entry_cmd', async () => {
    const user = userEvent.setup();
    render(<FileTree />);

    fireEvent.contextMenu(screen.getByTestId('tree-node-README.md'));
    await user.click(await screen.findByTestId('ctx-rename'));

    const input = screen.getByTestId('file-tree-rename-input');
    await user.clear(input);
    await user.type(input, 'README.zh-CN.md');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('rename_entry_cmd', {
        oldPath: '/proj/README.md',
        newPath: '/proj/README.zh-CN.md',
      });
    });

    expect(applyFsEventMock).toHaveBeenCalledWith({
      type: 'renamed',
      old_path: '/proj/README.md',
      new_path: '/proj/README.zh-CN.md',
    });
  });

  it('删除应通过确认对话框调用 delete_entry_cmd', async () => {
    const user = userEvent.setup();
    render(<FileTree />);

    fireEvent.contextMenu(screen.getByTestId('tree-node-README.md'));
    await user.click(await screen.findByTestId('ctx-delete'));
    expect(screen.getByTestId('file-tree-delete-dialog')).toBeInTheDocument();

    await user.click(screen.getByTestId('file-tree-delete-confirm'));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('delete_entry_cmd', {
        path: '/proj/README.md',
      });
    });

    expect(applyFsEventMock).toHaveBeenCalledWith({
      type: 'deleted',
      path: '/proj/README.md',
    });
  });
});
