/**
 * @file FileTree.test.tsx
 * @description FileTree 组件测试 - 验证目录树渲染、点击行为和右键菜单
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import FileTree from '../FileTree';
import { useFileTreeStore } from '../fileTreeStore';
import type { FileNode } from '../../../shared/types';

const mockInvoke = vi.mocked(invoke);

// 测试用文件树样本
const sampleTree: FileNode[] = [
  {
    entry: { name: 'src', path: '/proj/src', is_dir: true, size: undefined, modified: undefined },
    children: undefined, // 未展开
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
  useFileTreeStore.setState({ tree: [], expandedPaths: new Set() });
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
    // 预先填充 children，模拟已加载状态
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

describe('FileTree - 右键菜单', () => {
  beforeEach(() => {
    useFileTreeStore.setState({ tree: sampleTree, expandedPaths: new Set() });
  });

  it('节点应包含 ContextMenuTrigger 包装（data-path 属性存在）', () => {
    render(<FileTree />);
    const node = screen.getByTestId('tree-node-README.md');
    // 通过 data-path 属性验证节点正确渲染
    expect(node).toHaveAttribute('data-path', '/proj/README.md');
  });
});
