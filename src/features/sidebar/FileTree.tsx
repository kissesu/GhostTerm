/**
 * @file FileTree.tsx
 * @description 文件树组件 - 渲染可展开/折叠的目录树。
 *              目录支持懒加载，文件点击调用 invoke read_file_cmd（合并后接入真实 editorStore）。
 *              右键菜单支持新建文件/目录、重命名、删除操作。
 *              预留 Git 状态颜色标记接口（PBI-5 接入）。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { invoke } from '@tauri-apps/api/core';
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
} from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from '@radix-ui/react-context-menu';
import { useFileTreeStore } from './fileTreeStore';
import type { FileNode } from '../../shared/types';

/** FileTreeNode 组件的 Props */
interface FileTreeNodeProps {
  node: FileNode;
  /** 缩进层级（根节点为 0） */
  depth: number;
  /**
   * Git 状态 className 预留接口 - PBI-5 接入后通过此 prop 传入
   * 例：'git-modified' / 'git-untracked' / 'git-staged'
   */
  gitStatusClass?: string;
}

/** 单个文件树节点 */
function FileTreeNode({ node, depth, gitStatusClass }: FileTreeNodeProps) {
  const { expandedPaths, toggleDir } = useFileTreeStore();
  const isExpanded = expandedPaths.has(node.entry.path);
  const isDir = node.entry.is_dir;

  const handleClick = async () => {
    if (isDir) {
      await toggleDir(node.entry.path);
    } else {
      // 点击文件：invoke read_file_cmd，合并后接入真实 editorStore.openFile
      await invoke('read_file_cmd', { path: node.entry.path });
    }
  };

  const handleNewFile = async () => {
    const name = window.prompt('新建文件名：');
    if (!name) return;
    const parentPath = isDir ? node.entry.path : node.entry.path.split('/').slice(0, -1).join('/');
    await invoke('create_file_cmd', { path: `${parentPath}/${name}` });
  };

  const handleNewDir = async () => {
    const name = window.prompt('新建文件夹名：');
    if (!name) return;
    const parentPath = isDir ? node.entry.path : node.entry.path.split('/').slice(0, -1).join('/');
    await invoke('create_dir_cmd', { path: `${parentPath}/${name}` });
  };

  const handleRename = async () => {
    const name = window.prompt('重命名为：', node.entry.name);
    if (!name || name === node.entry.name) return;
    const newPath = node.entry.path.split('/').slice(0, -1).join('/') + '/' + name;
    await invoke('rename_entry_cmd', { oldPath: node.entry.path, newPath });
  };

  const handleDelete = async () => {
    const confirmed = window.confirm(`确认删除 "${node.entry.name}" ？`);
    if (!confirmed) return;
    await invoke('delete_entry_cmd', { path: node.entry.path });
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            onClick={handleClick}
            data-testid={`tree-node-${node.entry.name}`}
            data-path={node.entry.path}
            data-is-dir={isDir}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: `2px 8px 2px ${8 + depth * 16}px`,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#c0caf5',
              textAlign: 'left',
              fontSize: 13,
            }}
            className={gitStatusClass}
          >
            {/* 展开/折叠箭头（仅目录显示） */}
            <span style={{ width: 14, flexShrink: 0 }} aria-hidden>
              {isDir ? (
                isExpanded ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )
              ) : null}
            </span>

            {/* 文件/目录图标 */}
            <span style={{ flexShrink: 0 }} aria-hidden>
              {isDir ? (
                isExpanded ? (
                  <FolderOpen size={14} color="#7aa2f7" />
                ) : (
                  <Folder size={14} color="#7aa2f7" />
                )
              ) : (
                <File size={14} color="#565f89" />
              )}
            </span>

            {/* 文件名 */}
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {node.entry.name}
            </span>
          </button>
        </ContextMenuTrigger>

        {/* 右键菜单 */}
        <ContextMenuContent
          style={{
            background: '#1a1b26',
            border: '1px solid #27293d',
            borderRadius: 4,
            padding: '4px 0',
            minWidth: 160,
            zIndex: 200,
          }}
        >
          <ContextMenuItem
            onSelect={handleNewFile}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', cursor: 'pointer', fontSize: 13, color: '#c0caf5' }}
            data-testid="ctx-new-file"
          >
            <FilePlus size={12} aria-hidden />
            新建文件
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={handleNewDir}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', cursor: 'pointer', fontSize: 13, color: '#c0caf5' }}
            data-testid="ctx-new-dir"
          >
            <FolderPlus size={12} aria-hidden />
            新建文件夹
          </ContextMenuItem>
          <ContextMenuSeparator style={{ borderTop: '1px solid #27293d', margin: '2px 0' }} />
          <ContextMenuItem
            onSelect={handleRename}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', cursor: 'pointer', fontSize: 13, color: '#c0caf5' }}
            data-testid="ctx-rename"
          >
            <Pencil size={12} aria-hidden />
            重命名
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={handleDelete}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', cursor: 'pointer', fontSize: 13, color: '#e06c75' }}
            data-testid="ctx-delete"
          >
            <Trash2 size={12} aria-hidden />
            删除
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* 递归渲染子节点（仅当展开且 children 已加载时） */}
      {isDir && isExpanded && node.children && (
        <>
          {node.children.map((child) => (
            <FileTreeNode key={child.entry.path} node={child} depth={depth + 1} />
          ))}
        </>
      )}
    </>
  );
}

/** 文件树根组件 */
export default function FileTree() {
  const { tree } = useFileTreeStore();

  if (tree.length === 0) {
    return (
      <div
        style={{ padding: '16px 10px', fontSize: 12, color: '#565f89', textAlign: 'center' }}
        data-testid="file-tree-empty"
      >
        暂无文件
      </div>
    );
  }

  return (
    <div
      role="tree"
      aria-label="文件树"
      style={{ overflow: 'auto', height: '100%' }}
    >
      {tree.map((node) => (
        <FileTreeNode key={node.entry.path} node={node} depth={0} />
      ))}
    </div>
  );
}
