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
    projectRoot: null,
  });
  vi.clearAllMocks();
});

describe('fileTreeStore - refreshFileTree', () => {
  it('refreshFileTree 应调用 list_dir_cmd 并填充树', async () => {
    mockInvoke.mockResolvedValueOnce(sampleEntries);

    await useFileTreeStore.getState().refreshFileTree('/proj');

    expect(mockInvoke).toHaveBeenCalledWith('list_dir_cmd', { path: '/proj', showHidden: false });

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

  it('refreshFileTree 应保留 expandedPaths（fix: 避免新建/重命名/删除后目录塌陷）', async () => {
    // 预设一个展开路径
    useFileTreeStore.setState({ expandedPaths: new Set(['/proj/src']) });
    mockInvoke.mockResolvedValueOnce(sampleEntries);

    await useFileTreeStore.getState().refreshFileTree('/proj');

    const { expandedPaths } = useFileTreeStore.getState();
    // 旧行为会清空 → 0；修复后保留原值
    expect(expandedPaths.has('/proj/src')).toBe(true);
    expect(expandedPaths.size).toBe(1);
  });

  it('resetState 应清空 tree 和 expandedPaths（切换项目场景）', () => {
    useFileTreeStore.setState({
      tree: [{ entry: sampleEntries[0]!, children: undefined }],
      expandedPaths: new Set(['/proj/src', '/proj/docs']),
    });

    useFileTreeStore.getState().resetState();

    const { tree, expandedPaths } = useFileTreeStore.getState();
    expect(tree).toEqual([]);
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

    expect(mockInvoke).toHaveBeenCalledWith('list_dir_cmd', { path: '/proj/src', showHidden: false });
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

describe('fileTreeStore - applyFsEvent（完整实现）', () => {
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

  describe('deleted 事件', () => {
    beforeEach(async () => {
      // 初始化树：根级有 src 目录和 README.md 文件
      mockInvoke.mockResolvedValueOnce(sampleEntries);
      await useFileTreeStore.getState().refreshFileTree('/proj');
      vi.clearAllMocks();
    });

    it('deleted 事件应从树中移除对应节点', () => {
      // README.md 在根级，删除它
      useFileTreeStore.getState().applyFsEvent({ type: 'deleted', path: '/proj/README.md' });

      const { tree } = useFileTreeStore.getState();
      const found = tree.find((n) => n.entry.path === '/proj/README.md');
      expect(found).toBeUndefined();
    });

    it('deleted 事件后树中其他节点保持不变', () => {
      useFileTreeStore.getState().applyFsEvent({ type: 'deleted', path: '/proj/README.md' });

      const { tree } = useFileTreeStore.getState();
      // src 目录应还在
      expect(tree.find((n) => n.entry.path === '/proj/src')).toBeDefined();
    });

    it('deleted 事件不应清空 expandedPaths（fix: 避免操作后父目录塌陷）', () => {
      useFileTreeStore.setState({ expandedPaths: new Set(['/proj/src']) });

      useFileTreeStore.getState().applyFsEvent({ type: 'deleted', path: '/proj/README.md' });

      const { expandedPaths } = useFileTreeStore.getState();
      expect(expandedPaths.has('/proj/src')).toBe(true);
    });

    it('created/renamed 事件也不清空 expandedPaths', () => {
      useFileTreeStore.setState({ expandedPaths: new Set(['/proj/src']) });

      useFileTreeStore.getState().applyFsEvent({ type: 'created', path: '/proj/new.ts' });
      expect(useFileTreeStore.getState().expandedPaths.has('/proj/src')).toBe(true);

      useFileTreeStore.getState().applyFsEvent({
        type: 'renamed',
        old_path: '/proj/README.md',
        new_path: '/proj/README2.md',
      });
      expect(useFileTreeStore.getState().expandedPaths.has('/proj/src')).toBe(true);
    });

    it('deleted 事件应移除嵌套节点', async () => {
      // 先展开 src 目录，加载子节点
      mockInvoke.mockResolvedValueOnce(srcChildren);
      await useFileTreeStore.getState().toggleDir('/proj/src');
      vi.clearAllMocks();

      // 删除嵌套的 main.rs
      useFileTreeStore.getState().applyFsEvent({ type: 'deleted', path: '/proj/src/main.rs' });

      const { tree } = useFileTreeStore.getState();
      const srcNode = tree.find((n) => n.entry.path === '/proj/src');
      expect(srcNode?.children?.find((c) => c.entry.path === '/proj/src/main.rs')).toBeUndefined();
    });
  });

  describe('modified 事件', () => {
    beforeEach(async () => {
      mockInvoke.mockResolvedValueOnce(sampleEntries);
      await useFileTreeStore.getState().refreshFileTree('/proj');
      vi.clearAllMocks();
    });

    it('modified 事件不应改变树结构', () => {
      const treeBefore = useFileTreeStore.getState().tree;

      useFileTreeStore.getState().applyFsEvent({ type: 'modified', path: '/proj/README.md' });

      const treeAfter = useFileTreeStore.getState().tree;
      // 树的引用（结构）不变
      expect(treeAfter).toBe(treeBefore);
    });
  });

  describe('created 事件', () => {
    beforeEach(async () => {
      // 加载树并展开 src 目录
      mockInvoke.mockResolvedValueOnce(sampleEntries);
      await useFileTreeStore.getState().refreshFileTree('/proj');
      mockInvoke.mockResolvedValueOnce(srcChildren);
      await useFileTreeStore.getState().toggleDir('/proj/src');
      vi.clearAllMocks();
    });

    it('created 事件应调用 list_dir_cmd 刷新父目录', async () => {
      // 模拟刷新父目录返回增加了新文件的列表
      const updatedSrcChildren: FileEntry[] = [
        ...srcChildren,
        { name: 'new.rs', path: '/proj/src/new.rs', is_dir: false, size: 0, modified: undefined },
      ];
      mockInvoke.mockResolvedValueOnce(updatedSrcChildren);

      useFileTreeStore.getState().applyFsEvent({ type: 'created', path: '/proj/src/new.rs' });

      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('list_dir_cmd', { path: '/proj/src', showHidden: false });
      });
    });

    it('created 事件后父目录 children 包含新节点', async () => {
      const updatedSrcChildren: FileEntry[] = [
        ...srcChildren,
        { name: 'new.rs', path: '/proj/src/new.rs', is_dir: false, size: 0, modified: undefined },
      ];
      mockInvoke.mockResolvedValueOnce(updatedSrcChildren);

      useFileTreeStore.getState().applyFsEvent({ type: 'created', path: '/proj/src/new.rs' });

      await vi.waitFor(() => {
        const { tree } = useFileTreeStore.getState();
        const srcNode = tree.find((n) => n.entry.path === '/proj/src');
        expect(srcNode?.children?.find((c) => c.entry.path === '/proj/src/new.rs')).toBeDefined();
      });
    });
  });

  describe('renamed 事件', () => {
    beforeEach(async () => {
      mockInvoke.mockResolvedValueOnce(sampleEntries);
      await useFileTreeStore.getState().refreshFileTree('/proj');
      mockInvoke.mockResolvedValueOnce(srcChildren);
      await useFileTreeStore.getState().toggleDir('/proj/src');
      vi.clearAllMocks();
    });

    it('renamed 事件应移除旧路径节点', async () => {
      // 重命名后的父目录内容（旧文件消失，新文件出现）
      const renamedChildren: FileEntry[] = [
        { name: 'renamed.rs', path: '/proj/src/renamed.rs', is_dir: false, size: 200, modified: undefined },
        { name: 'lib.rs', path: '/proj/src/lib.rs', is_dir: false, size: 300, modified: undefined },
      ];
      mockInvoke.mockResolvedValueOnce(renamedChildren);

      useFileTreeStore.getState().applyFsEvent({
        type: 'renamed',
        old_path: '/proj/src/main.rs',
        new_path: '/proj/src/renamed.rs',
      });

      // 旧节点立即移除（同步操作）
      const { tree } = useFileTreeStore.getState();
      const srcNode = tree.find((n) => n.entry.path === '/proj/src');
      expect(srcNode?.children?.find((c) => c.entry.path === '/proj/src/main.rs')).toBeUndefined();
    });
  });

  // ============================================
  // 项目根级事件回归测试
  // 修复盲区：tree 顶层是项目根的"子项"，根本身不在 tree 中；
  // findNodeByPath 找不到根级父目录会丢事件，必须用 projectRoot 字段比对
  // 调用 refreshFileTree 替换顶层
  // ============================================
  describe('项目根级 created/renamed 事件', () => {
    beforeEach(async () => {
      // refreshFileTree 写入 projectRoot=/proj，作为根级判定依据
      mockInvoke.mockResolvedValueOnce(sampleEntries);
      await useFileTreeStore.getState().refreshFileTree('/proj');
      vi.clearAllMocks();
    });

    it('refreshFileTree 应记录 projectRoot', () => {
      // 上一步 beforeEach 已调 refreshFileTree('/proj')
      expect(useFileTreeStore.getState().projectRoot).toBe('/proj');
    });

    it('根级 created 事件应触发 refreshFileTree 替换顶层（而非 refreshParentDir 静默丢弃）', async () => {
      // 模拟根目录刷新返回新增了 newroot.txt 的列表
      const updatedRootEntries: FileEntry[] = [
        ...sampleEntries,
        { name: 'newroot.txt', path: '/proj/newroot.txt', is_dir: false, size: 0, modified: undefined },
      ];
      mockInvoke.mockResolvedValueOnce(updatedRootEntries);

      useFileTreeStore.getState().applyFsEvent({ type: 'created', path: '/proj/newroot.txt' });

      // 必须触发对项目根的 list_dir_cmd 调用
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('list_dir_cmd', { path: '/proj', showHidden: false });
      });

      // 顶层 tree 应包含新文件
      const { tree } = useFileTreeStore.getState();
      expect(tree.find((n) => n.entry.path === '/proj/newroot.txt')).toBeDefined();
    });

    it('根级 renamed 事件应移除旧节点 + 刷新顶层插入新节点', async () => {
      // 模拟重命名后根目录内容（README.md → README.rst）
      const renamedRootEntries: FileEntry[] = [
        { name: 'src', path: '/proj/src', is_dir: true, size: undefined, modified: undefined },
        { name: 'README.rst', path: '/proj/README.rst', is_dir: false, size: 100, modified: undefined },
        { name: 'Cargo.toml', path: '/proj/Cargo.toml', is_dir: false, size: 500, modified: undefined },
      ];
      mockInvoke.mockResolvedValueOnce(renamedRootEntries);

      useFileTreeStore.getState().applyFsEvent({
        type: 'renamed',
        old_path: '/proj/README.md',
        new_path: '/proj/README.rst',
      });

      // 同步阶段：旧节点立即从 tree 移除
      let { tree } = useFileTreeStore.getState();
      expect(tree.find((n) => n.entry.path === '/proj/README.md')).toBeUndefined();

      // 异步阶段：触发根目录刷新并插入新节点
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('list_dir_cmd', { path: '/proj', showHidden: false });
      });
      tree = useFileTreeStore.getState().tree;
      expect(tree.find((n) => n.entry.path === '/proj/README.rst')).toBeDefined();
    });

    it('未展开子目录的深层 created 事件应静默忽略（避免误识别为根级灾难性刷新）', async () => {
      // /proj/src 在 tree 中但未展开 → src.children 为 undefined
      // /proj/src/deep/file.rs 的 parentPath = /proj/src/deep，既不是 projectRoot 也不在 tree 中
      // 必须不触发任何 list_dir_cmd（不在用户当前可见范围内，不需要刷新）
      useFileTreeStore.getState().applyFsEvent({ type: 'created', path: '/proj/src/deep/file.rs' });

      // 给微任务一次机会触发
      await Promise.resolve();
      await Promise.resolve();
      expect(mockInvoke).not.toHaveBeenCalled();
    });
  });

  describe('resetState', () => {
    it('应同时清空 tree、expandedPaths、projectRoot', async () => {
      mockInvoke.mockResolvedValueOnce(sampleEntries);
      await useFileTreeStore.getState().refreshFileTree('/proj');

      // 验证设置成功
      expect(useFileTreeStore.getState().projectRoot).toBe('/proj');
      expect(useFileTreeStore.getState().tree).not.toHaveLength(0);

      useFileTreeStore.getState().resetState();

      const state = useFileTreeStore.getState();
      expect(state.tree).toEqual([]);
      expect(state.expandedPaths.size).toBe(0);
      expect(state.projectRoot).toBeNull();
    });
  });
});
