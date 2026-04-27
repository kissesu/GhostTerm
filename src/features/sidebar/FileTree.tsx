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
import { useCallback, useState } from 'react';
import { openPath } from '@tauri-apps/plugin-opener';
import { useFileTreeStore } from './fileTreeStore';
import { useGitStore } from './gitStore';
import { useProjectStore } from './projectStore';
import { useEditorStore } from '../editor/editorStore';
import { useFsEvents } from '../../shared/hooks/useFsEvents';
import SidebarDialog, { dialogButtonStyle, dialogInputStyle } from './SidebarDialog';
import type { FileNode, StatusEntry, FsEvent } from '../../shared/types';

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

  const relativePath = currentProjectPath && node.entry.path.startsWith(`${currentProjectPath}/`)
    ? node.entry.path.slice(currentProjectPath.length + 1)
    : node.entry.name;

  const copyToClipboard = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // WebView2(Windows) 在上下文菜单关闭瞬间 clipboard API 可能失败
      // 用 execCommand 回退，兼容所有平台
      const el = document.createElement('textarea');
      el.value = value;
      Object.assign(el.style, { position: 'fixed', top: '-999px', left: '-999px', opacity: '0' });
      document.body.appendChild(el);
      el.focus();
      el.select();
      try { document.execCommand('copy'); } finally { document.body.removeChild(el); }
    }
  };

  // 向活跃终端发送文本（通过 CustomEvent 桥接到 Terminal 组件的 WebSocket）
  const sendToTerminal = (text: string) => {
    window.dispatchEvent(new CustomEvent('ghostterm:terminal-input', { detail: text }));
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
    const newPath = `${parentPath}/${name}`;
    await invoke('create_entry_cmd', { path: newPath, isDir: createMode === 'dir' });
    // 乐观更新：保留父目录的 expanded 状态（不走全量 refreshFileTree，避免 expandedPaths 被重置）
    useFileTreeStore.getState().applyFsEvent({ type: 'created', path: newPath });
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
    const oldPath = node.entry.path;
    const newPath = `${oldPath.split('/').slice(0, -1).join('/')}/${name}`;
    await invoke('rename_entry_cmd', { oldPath, newPath });
    // 乐观更新：保留父目录的 expanded 状态
    useFileTreeStore.getState().applyFsEvent({ type: 'renamed', old_path: oldPath, new_path: newPath });
    setRenameOpen(false);
  };

  const submitDelete = async () => {
    const path = node.entry.path;
    await invoke('delete_entry_cmd', { path });
    // 乐观更新：保留父目录的 expanded 状态
    useFileTreeStore.getState().applyFsEvent({ type: 'deleted', path });
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
            onSelect={() => sendToTerminal(node.entry.path)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--c-fg)', borderRadius: 4, fontFamily: 'var(--font-ui)' }}
          >
            <Send size={12} aria-hidden />
            发送路径
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => sendToTerminal(relativePath)}
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
 * 颜色规则（与 Changes 面板状态颜色保持一致，色值由 --c-git-* CSS 变量控制）：
 * - M（修改）→ git-modified
 * - A（新增）/ ?（未跟踪）→ git-untracked
 * - D（删除）→ git-deleted
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
  // 单文件模式判定依据：当前无项目 + 编辑器有打开文件
  // 来源：Open With（Finder 右键）打开单文件时 useOpenWithFile 仅 openFile，不动 projectStore
  const currentProject = useProjectStore((s) => s.currentProject);
  const openFilesCount = useEditorStore((s) => s.openFiles.length);

  // 订阅 Rust watcher 推送的文件系统事件，驱动增量更新
  // 用 getState() 拿 action 引用（稳定），避免 useEffect 重复订阅
  const handleFsEvent = useCallback((event: FsEvent) => {
    useFileTreeStore.getState().applyFsEvent(event);
  }, []);
  useFsEvents(handleFsEvent);

  if (tree.length === 0) {
    // 区分三种空状态：
    // 1. 单文件模式：无项目 + 有打开文件（来自 Open With）→ 提示用户当前模式
    // 2. 未打开项目：无项目 + 无打开文件 → 引导用户打开项目
    // 3. 项目空目录：有项目 + 无文件 → 简单提示
    const isGhostFileMode = !currentProject && openFilesCount > 0;
    const message = isGhostFileMode
      ? '单文件模式 — 打开项目以查看文件树'
      : !currentProject
        ? '未打开项目'
        : '暂无文件';
    return (
      <div
        style={{ padding: '16px 10px', fontSize: 12, color: 'var(--c-fg-subtle)', textAlign: 'center', lineHeight: 1.6 }}
        data-testid="file-tree-empty"
        data-mode={isGhostFileMode ? 'ghost-file' : (currentProject ? 'empty-project' : 'no-project')}
      >
        {message}
      </div>
    );
  }

  return (
    <>
      {/* Git 状态颜色样式（注入到 shadow DOM 外层） */}
      {/* Git 状态颜色用 CSS token，跟随 dark/light 主题 */}
      <style>{`
        .git-modified  { color: var(--c-git-modified)  !important; }
        .git-added     { color: var(--c-git-added)     !important; }
        .git-deleted   { color: var(--c-git-deleted)   !important; }
        .git-renamed   { color: var(--c-git-renamed)   !important; }
        .git-untracked { color: var(--c-git-untracked) !important; }
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
