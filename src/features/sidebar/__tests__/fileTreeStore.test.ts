/**
 * @file fileTreeStore.test.ts
 * @description fileTreeStore 单元测试 - 验证文件树刷新、目录展开/折叠、增量更新骨架
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useFileTreeStore } from '../fileTreeStore';
import type { FileEntry } from '../../../shared/types';

const mockInvoke = vi.mocked(invoke);

// 测试用目录条目样本
const sampleEntries: FileEntry[] = [
  { name: 'src', path: '/proj/src', is_dir: true, size: undefined, modified: undefined },
  { name: 'README.md', path: '/proj/README.md', is_dir: false, size: 100, modified: 1713024000000 },
  { name: 'Cargo.toml', path: '/proj/Cargo.toml', is_dir: false, size: 500, modified: 1713020000000 },
];

const srcChildren: FileEntry[] = [
  { name: 'main.rs', path: '/proj/src/main.rs', is_dir: false, size: 200, modified: 1713024000000 },
  { name: 'lib.rs', path: '/proj/src/lib.rs', is_dir: false, size: 300, modified: 1713024000000 },
];

beforeEach(() => {
  useFileTreeStore.setState({
    tree: [],
    expandedPaths: new Set(),
  });
  vi.clearAllMocks();
});

describe('fileTreeStore - refreshFileTree', () => {
  it('refreshFileTree 应调用 list_dir_cmd 并填充树', async () => {
    mockInvoke.mockResolvedValueOnce(sampleEntries);

    await useFileTreeStore.getState().refreshFileTree('/proj');

    expect(mockInvoke).toHaveBeenCalledWith('list_dir_cmd', { path: '/proj' });

    const { tree } = useFileTreeStore.getState();
    expect(tree).toHaveLength(3);
    expect(tree[0].entry.name).toBe('src');
    expect(tree[1].entry.name).toBe('README.md');
  });

  it('目录节点 children 应为 undefined（待懒加载）', async () => {
    mockInvoke.mockResolvedValueOnce(sampleEntries);
    await useFileTreeStore.getState().refreshFileTree('/proj');

    const { tree } = useFileTreeStore.getState();
    const dirNode = tree.find((n) => n.entry.is_dir);
    expect(dirNode?.children).toBeUndefined();
  });

  it('文件节点 children 应为 null（不可展开）', async () => {
    mockInvoke.mockResolvedValueOnce(sampleEntries);
    await useFileTreeStore.getState().refreshFileTree('/proj');

    const { tree } = useFileTreeStore.getState();
    const fileNode = tree.find((n) => !n.entry.is_dir);
    expect(fileNode?.children).toBeNull();
  });

  it('refreshFileTree 应清空 expandedPaths', async () => {
    // 预设一个展开路径
    useFileTreeStore.setState({ expandedPaths: new Set(['/proj/src']) });
    mockInvoke.mockResolvedValueOnce(sampleEntries);

    await useFileTreeStore.getState().refreshFileTree('/proj');

    const { expandedPaths } = useFileTreeStore.getState();
    expect(expandedPaths.size).toBe(0);
  });
});

describe('fileTreeStore - toggleDir', () => {
  beforeEach(async () => {
    // 先刷新树，建立初始状态
    mockInvoke.mockResolvedValueOnce(sampleEntries);
    await useFileTreeStore.getState().refreshFileTree('/proj');
    vi.clearAllMocks();
  });

  it('展开目录时应调用 list_dir_cmd 懒加载子节点', async () => {
    mockInvoke.mockResolvedValueOnce(srcChildren);

    await useFileTreeStore.getState().toggleDir('/proj/src');

    expect(mockInvoke).toHaveBeenCalledWith('list_dir_cmd', { path: '/proj/src' });
  });

  it('展开目录后 expandedPaths 应包含该路径', async () => {
    mockInvoke.mockResolvedValueOnce(srcChildren);
    await useFileTreeStore.getState().toggleDir('/proj/src');

    const { expandedPaths } = useFileTreeStore.getState();
    expect(expandedPaths.has('/proj/src')).toBe(true);
  });

  it('展开目录后子节点应被填充', async () => {
    mockInvoke.mockResolvedValueOnce(srcChildren);
    await useFileTreeStore.getState().toggleDir('/proj/src');

    const { tree } = useFileTreeStore.getState();
    const srcNode = tree.find((n) => n.entry.path === '/proj/src');
    expect(srcNode?.children).toHaveLength(2);
    expect(srcNode?.children?.[0].entry.name).toBe('main.rs');
  });

  it('折叠已展开目录时应从 expandedPaths 移除', async () => {
    // 先展开
    mockInvoke.mockResolvedValueOnce(srcChildren);
    await useFileTreeStore.getState().toggleDir('/proj/src');
    vi.clearAllMocks();

    // 再折叠
    await useFileTreeStore.getState().toggleDir('/proj/src');

    const { expandedPaths } = useFileTreeStore.getState();
    expect(expandedPaths.has('/proj/src')).toBe(false);
  });

  it('折叠后再次展开不应重新调用 list_dir_cmd（使用缓存）', async () => {
    // 先展开（懒加载）
    mockInvoke.mockResolvedValueOnce(srcChildren);
    await useFileTreeStore.getState().toggleDir('/proj/src');

    // 折叠
    await useFileTreeStore.getState().toggleDir('/proj/src');
    vi.clearAllMocks();

    // 再次展开 - children 已缓存，不应再调用 invoke
    await useFileTreeStore.getState().toggleDir('/proj/src');

    expect(mockInvoke).not.toHaveBeenCalled();

    const { expandedPaths } = useFileTreeStore.getState();
    expect(expandedPaths.has('/proj/src')).toBe(true);
  });
});

describe('fileTreeStore - applyFsEvent（骨架）', () => {
  it('applyFsEvent 不应抛出异常', () => {
    expect(() => {
      useFileTreeStore.getState().applyFsEvent({ type: 'created', path: '/proj/new.ts' });
    }).not.toThrow();

    expect(() => {
      useFileTreeStore.getState().applyFsEvent({ type: 'deleted', path: '/proj/old.ts' });
    }).not.toThrow();

    expect(() => {
      useFileTreeStore.getState().applyFsEvent({ type: 'modified', path: '/proj/main.ts' });
    }).not.toThrow();

    expect(() => {
      useFileTreeStore.getState().applyFsEvent({
        type: 'renamed',
        old_path: '/proj/a.ts',
        new_path: '/proj/b.ts',
      });
    }).not.toThrow();
  });
});
