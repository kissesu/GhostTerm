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
  Copy,
  Scissors,
  ExternalLink,
  Send,
} from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from '@radix-ui/react-context-menu';
import { useState } from 'react';
import { openPath } from '@tauri-apps/plugin-opener';
import { useFileTreeStore } from './fileTreeStore';
import { useGitStore } from './gitStore';
import { useProjectStore } from './projectStore';
import { useEditorStore } from '../editor/editorStore';
import SidebarDialog, { dialogButtonStyle, dialogInputStyle } from './SidebarDialog';
import type { FileNode, StatusEntry } from '../../shared/types';

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
  const { expandedPaths, toggleDir, refreshFileTree } = useFileTreeStore();
  const currentProjectPath = useProjectStore((s) => s.currentProject?.path);
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const isExpanded = expandedPaths.has(node.entry.path);
  const isDir = node.entry.is_dir;
  const isActive = activeFilePath === node.entry.path;
  const parentPath = isDir ? node.entry.path : node.entry.path.split('/').slice(0, -1).join('/');

  const [createMode, setCreateMode] = useState<'file' | 'dir' | null>(null);
  const [createName, setCreateName] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState(node.entry.name);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const refreshCurrentProjectTree = async () => {
    if (currentProjectPath) {
      await refreshFileTree(currentProjectPath);
    }
  };

  const relativePath = currentProjectPath && node.entry.path.startsWith(`${currentProjectPath}/`)
    ? node.entry.path.slice(currentProjectPath.length + 1)
    : node.entry.name;

  const copyToClipboard = async (value: string) => {
    await navigator.clipboard.writeText(value);
  };

  const handleClick = async () => {
    if (isDir) {
      await toggleDir(node.entry.path);
    } else {
      await useEditorStore.getState().openFile(node.entry.path);
    }
  };

  const openCreateDialog = (mode: 'file' | 'dir') => {
    setCreateMode(mode);
    setCreateName('');
  };

  const submitCreate = async () => {
    const name = createName.trim();
    if (!name) return;
    await invoke('create_entry_cmd', { path: `${parentPath}/${name}`, isDir: createMode === 'dir' });
    await refreshCurrentProjectTree();
    setCreateMode(null);
    setCreateName('');
  };

  const openRenameDialog = () => {
    setRenameName(node.entry.name);
    setRenameOpen(true);
  };

  const submitRename = async () => {
    const name = renameName.trim();
    if (!name || name === node.entry.name) {
      setRenameOpen(false);
      setRenameName(node.entry.name);
      return;
    }
    const newPath = `${node.entry.path.split('/').slice(0, -1).join('/')}/${name}`;
    await invoke('rename_entry_cmd', { oldPath: node.entry.path, newPath });
    await refreshCurrentProjectTree();
    setRenameOpen(false);
  };

  const submitDelete = async () => {
    await invoke('delete_entry_cmd', { path: node.entry.path });
    await refreshCurrentProjectTree();
    setDeleteOpen(false);
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
            data-active={isActive ? 'true' : 'false'}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: `2px 8px 2px ${8 + depth * 16}px`,
              /* 活跃状态用 accent-dim 背景，与新主题保持一致；去掉左侧粗边框反模式 */
              background: isActive ? 'var(--c-accent-dim)' : 'transparent',
              border: 'none',
              borderLeft: 'none',
              cursor: 'pointer',
              color: isActive ? 'var(--c-accent)' : 'var(--c-fg-muted)',
              textAlign: 'left',
              fontSize: 12,
              fontFamily: 'var(--font-ui)',
              transition: 'background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)',
            }}
            /* 活跃文件不叠加 git 状态颜色：活跃背景已足够说明状态，避免视觉冲突 */
            className={isActive ? undefined : gitStatusClass}
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

            {/* 文件/目录图标：活跃时用 accent 色，否则用 muted */}
            <span style={{ flexShrink: 0, color: isActive ? 'var(--c-accent)' : 'var(--c-fg-subtle)' }} aria-hidden>
              {isDir ? (
                isExpanded ? (
                  <FolderOpen size={13} color="currentColor" />
                ) : (
                  <Folder size={13} color="currentColor" />
                )
              ) : (
                <File size={13} color="currentColor" />
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

        {/* 右键菜单 — 使用 CSS token，跟随主题 */}
        <ContextMenuContent
          style={{
            background: 'var(--c-overlay)',
            border: '1px solid var(--c-border)',
            borderRadius: 'var(--r-md)',
            padding: '4px',
            minWidth: 168,
            zIndex: 200,
            boxShadow: 'var(--shadow-menu)',
          }}
        >
          {isDir && (
            <>
              <ContextMenuItem
                onSelect={() => openCreateDialog('file')}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--c-fg)', borderRadius: 4, fontFamily: 'var(--font-ui)' }}
                data-testid="ctx-new-file"
              >
                <FilePlus size={12} aria-hidden />
                新建文件
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => openCreateDialog('dir')}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--c-fg)', borderRadius: 4, fontFamily: 'var(--font-ui)' }}
                data-testid="ctx-new-dir"
              >
                <FolderPlus size={12} aria-hidden />
                新建文件夹
              </ContextMenuItem>
              <ContextMenuSeparator style={{ borderTop: '1px solid var(--c-border-sub)', margin: '4px 0' }} />
            </>
          )}
          <ContextMenuItem
            onSelect={() => { void openPath(node.entry.path); }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--c-fg)', borderRadius: 4, fontFamily: 'var(--font-ui)' }}
          >
            <ExternalLink size={12} aria-hidden />
            在 Finder 中显示
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => { void copyToClipboard(node.entry.path); }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--c-fg)', borderRadius: 4, fontFamily: 'var(--font-ui)' }}
          >
            <Copy size={12} aria-hidden />
            复制
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => { void copyToClipboard(node.entry.path); }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--c-fg)', borderRadius: 4, fontFamily: 'var(--font-ui)' }}
          >
            <Scissors size={12} aria-hidden />
            剪切
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => { void copyToClipboard(node.entry.path); }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--c-fg)', borderRadius: 4, fontFamily: 'var(--font-ui)' }}
          >
            <Copy size={12} aria-hidden />
            复制路径
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => { void copyToClipboard(node.entry.path); }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--c-fg)', borderRadius: 4, fontFamily: 'var(--font-ui)' }}
          >
            <Send size={12} aria-hidden />
            发送路径
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => { void copyToClipboard(relativePath); }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--c-fg)', borderRadius: 4, fontFamily: 'var(--font-ui)' }}
          >
            <Send size={12} aria-hidden />
            发送相对路径
          </ContextMenuItem>
          <ContextMenuSeparator style={{ borderTop: '1px solid var(--c-border-sub)', margin: '4px 0' }} />
          <ContextMenuItem
            onSelect={openRenameDialog}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--c-fg)', borderRadius: 4, fontFamily: 'var(--font-ui)' }}
            data-testid="ctx-rename"
          >
            <Pencil size={12} aria-hidden />
            重命名
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => setDeleteOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--c-danger)', borderRadius: 4, fontFamily: 'var(--font-ui)' }}
            data-testid="ctx-delete"
          >
            <Trash2 size={12} aria-hidden />
            删除
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {createMode && (
        <SidebarDialog
          title={createMode === 'file' ? '新建文件' : '新建文件夹'}
          description={`将在 ${parentPath} 下创建新的${createMode === 'file' ? '文件' : '文件夹'}。`}
          onClose={() => {
            setCreateMode(null);
            setCreateName('');
          }}
          footer={(
            <>
              <button type="button" onClick={() => {
                setCreateMode(null);
                setCreateName('');
              }} style={{ ...dialogButtonStyle(), padding: '9px 14px', borderRadius: 10 }}>
                取消
              </button>
              <button type="button" onClick={submitCreate} disabled={!createName.trim()} style={{ ...dialogButtonStyle('primary'), padding: '9px 14px', borderRadius: 10, opacity: createName.trim() ? 1 : 0.55, cursor: createName.trim() ? 'pointer' : 'not-allowed' }}>
                创建
              </button>
            </>
          )}
          testId="file-tree-create-dialog"
        >
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--c-fg)', marginBottom: 8 }}>
            名称
          </label>
          <input
            autoFocus
            type="text"
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && createName.trim()) {
                void submitCreate();
              }
            }}
            placeholder={createMode === 'file' ? '例如：index.ts' : '例如：components'}
            style={dialogInputStyle()}
            data-testid="file-tree-create-input"
          />
        </SidebarDialog>
      )}

      {renameOpen && (
        <SidebarDialog
          title="重命名"
          description={`将 ${node.entry.name} 重命名为新的名称。`}
          onClose={() => {
            setRenameOpen(false);
            setRenameName(node.entry.name);
          }}
          footer={(
            <>
              <button type="button" onClick={() => {
                setRenameOpen(false);
                setRenameName(node.entry.name);
              }} style={{ ...dialogButtonStyle(), padding: '9px 14px', borderRadius: 10 }}>
                取消
              </button>
              <button type="button" onClick={submitRename} disabled={!renameName.trim()} style={{ ...dialogButtonStyle('primary'), padding: '9px 14px', borderRadius: 10, opacity: renameName.trim() ? 1 : 0.55, cursor: renameName.trim() ? 'pointer' : 'not-allowed' }}>
                保存
              </button>
            </>
          )}
          testId="file-tree-rename-dialog"
        >
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--c-fg)', marginBottom: 8 }}>
            新名称
          </label>
          <input
            autoFocus
            type="text"
            value={renameName}
            onChange={(event) => setRenameName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && renameName.trim()) {
                void submitRename();
              }
            }}
            style={dialogInputStyle()}
            data-testid="file-tree-rename-input"
          />
        </SidebarDialog>
      )}

      {deleteOpen && (
        <SidebarDialog
          title="确认删除"
          description={<>删除后无法恢复。<br />目标：{node.entry.name}</>}
          onClose={() => setDeleteOpen(false)}
          footer={(
            <>
              <button type="button" onClick={() => setDeleteOpen(false)} style={{ ...dialogButtonStyle(), padding: '9px 14px', borderRadius: 10 }}>
                取消
              </button>
              <button type="button" onClick={submitDelete} style={{ ...dialogButtonStyle('danger'), padding: '9px 14px', borderRadius: 10 }} data-testid="file-tree-delete-confirm">
                删除
              </button>
            </>
          )}
          testId="file-tree-delete-dialog"
        />
      )}

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

/**
 * 根据 git 状态确定节点的 CSS class 名称
 *
 * 颜色规则（与 Changes 面板状态颜色保持一致）：
 * - M（修改）→ git-modified（黄色 #e0af68）
 * - A（新增）/ ?（未跟踪）→ git-untracked（绿色 #9ece6a）
 * - D（删除）→ git-deleted（红色 #f7768e）
 */
function resolveGitStatusClass(path: string, changes: StatusEntry[]): string | undefined {
  // 取文件名匹配（git status 返回相对路径，FileTree 使用绝对路径）
  // 通过检查绝对路径是否以 git 相对路径结尾来匹配
  const entry = changes.find((e: StatusEntry) => path.endsWith(`/${e.path}`) || path === e.path);
  if (!entry) return undefined;

  // 优先判断 staged 状态
  const status = entry.staged ?? entry.unstaged;
  if (!status) return undefined;

  if (status === 'M' || status === 'R') return 'git-modified';
  if (status === 'A' || status === '?') return 'git-untracked';
  if (status === 'D') return 'git-deleted';

  return undefined;
}

/** 文件树根组件 */
export default function FileTree() {
  const { tree } = useFileTreeStore();
  // 从 gitStore 获取变更列表，用于给文件着色
  const { changes } = useGitStore();

  if (tree.length === 0) {
    return (
      <div
        style={{ padding: '16px 10px', fontSize: 12, color: 'var(--c-fg-subtle)', textAlign: 'center' }}
        data-testid="file-tree-empty"
      >
        暂无文件
      </div>
    );
  }

  return (
    <>
      {/* Git 状态颜色样式（注入到 shadow DOM 外层） */}
      {/* Git 状态颜色用 CSS token，跟随 dark/light 主题 */}
      <style>{`
        .git-modified  { color: var(--c-warning) !important; }
        .git-untracked { color: var(--c-success) !important; }
        .git-deleted   { color: var(--c-danger)  !important; }
        [data-active="false"]:hover { background: var(--c-hover) !important; }
      `}</style>
      <div
        role="tree"
        aria-label="文件树"
        onWheel={(e) => e.stopPropagation()}
        style={{ overflow: 'auto', width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}
      >
        {tree.map((node) => (
          <FileTreeNode
            key={node.entry.path}
            node={node}
            depth={0}
            gitStatusClass={resolveGitStatusClass(node.entry.path, changes)}
          />
        ))}
      </div>
    </>
  );
}
