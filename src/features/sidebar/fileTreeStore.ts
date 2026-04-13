/**
 * @file fileTreeStore.ts
 * @description 文件树状态管理 - 管理目录树结构和展开状态。
 *              通过 invoke list_dir_cmd 懒加载子目录内容，
 *              applyFsEvent 在 PBI-4 完善后处理实时增量更新。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { FileNode, FsEvent, FileEntry } from '../../shared/types';

/** 文件树状态 */
interface FileTreeState {
  /** 根节点列表 */
  tree: FileNode[];
  /** 已展开的目录路径集合（用于控制 UI 展开/折叠状态） */
  expandedPaths: Set<string>;
  /** 刷新指定根路径下的文件树 */
  refreshFileTree: (rootPath: string) => Promise<void>;
  /** 展开或折叠目录（懒加载子节点内容） */
  toggleDir: (path: string) => Promise<void>;
  /** 应用文件系统事件进行增量更新（PBI-4 完善） */
  applyFsEvent: (event: FsEvent) => void;
}

/**
 * 在树中找到指定路径的节点，返回节点引用
 * 深度优先搜索，找到后立即返回
 */
function findNodeByPath(nodes: FileNode[], targetPath: string): FileNode | null {
  for (const node of nodes) {
    if (node.entry.path === targetPath) {
      return node;
    }
    if (node.children) {
      const found = findNodeByPath(node.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

/**
 * 在树中更新指定路径节点的 children，返回新的树（不可变更新）
 */
function updateNodeChildren(
  nodes: FileNode[],
  targetPath: string,
  newChildren: FileNode[],
): FileNode[] {
  return nodes.map((node) => {
    if (node.entry.path === targetPath) {
      return { ...node, children: newChildren };
    }
    if (node.children) {
      return {
        ...node,
        children: updateNodeChildren(node.children, targetPath, newChildren),
      };
    }
    return node;
  });
}

export const useFileTreeStore = create<FileTreeState>((set, get) => ({
  tree: [],
  expandedPaths: new Set(),

  /**
   * 刷新文件树
   *
   * 业务逻辑：
   * 1. 调用 list_dir_cmd 获取根目录内容（非递归，只加载第一层）
   * 2. 将目录节点的 children 设为 undefined（表示可展开但未加载）
   * 3. 文件节点的 children 保持 null（不可展开）
   * 4. 清空展开状态（新项目重置展开记录）
   */
  refreshFileTree: async (rootPath: string) => {
    const entries = await invoke<FileEntry[]>('list_dir_cmd', { path: rootPath });

    // 将 FileEntry 列表转换为 FileNode 树（第一层）
    const tree: FileNode[] = entries.map((entry) => ({
      entry,
      // 目录节点 children=undefined 表示"可展开但尚未加载"
      // 文件节点 children=null 表示"不可展开"
      children: entry.is_dir ? undefined : null,
    }));

    set({ tree, expandedPaths: new Set() });
  },

  /**
   * 展开/折叠目录
   *
   * 业务逻辑：
   * 1. 若目录已展开 → 折叠（从 expandedPaths 移除，但保留已加载的 children 供下次快速展开）
   * 2. 若目录未展开且 children 已加载 → 直接展开
   * 3. 若目录未展开且 children 未加载 → 调用 list_dir_cmd 懒加载，再展开
   */
  toggleDir: async (path: string) => {
    const { expandedPaths, tree } = get();

    if (expandedPaths.has(path)) {
      // 折叠：仅从展开集合移除，保留 children 缓存
      const newExpanded = new Set(expandedPaths);
      newExpanded.delete(path);
      set({ expandedPaths: newExpanded });
      return;
    }

    // 需要展开：检查 children 是否已加载
    const node = findNodeByPath(tree, path);
    if (!node) return;

    let newTree = tree;

    if (node.children === undefined) {
      // children=undefined 表示尚未加载，懒加载子目录
      const entries = await invoke<FileEntry[]>('list_dir_cmd', { path });
      const children: FileNode[] = entries.map((entry) => ({
        entry,
        children: entry.is_dir ? undefined : null,
      }));
      newTree = updateNodeChildren(tree, path, children);
    }

    const newExpanded = new Set(expandedPaths);
    newExpanded.add(path);
    set({ tree: newTree, expandedPaths: newExpanded });
  },

  /**
   * 应用文件系统事件（增量更新）
   *
   * PBI-4 时由 fs_backend watcher 推送事件后调用此方法。
   * 当前为骨架实现，仅记录事件类型，不修改树状态。
   * PBI-4 完善后将处理 created/deleted/renamed/modified 各类事件。
   */
  applyFsEvent: (event: FsEvent) => {
    // PBI-4 完善：根据事件类型增量更新树节点
    // created → 在对应父目录 children 中插入新节点
    // deleted → 从树中移除对应节点
    // renamed → 更新节点路径
    // modified → 无需修改树结构（仅文件内容变化）
    console.log('[fileTreeStore] FsEvent received (PBI-4 to implement):', event.type);
  },
}));
