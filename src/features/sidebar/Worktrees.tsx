/**
 * @file Worktrees.tsx
 * @description Git Worktree 管理面板 - 展示所有 worktree 列表，支持切换/创建/删除操作。
 *              当前活跃的 worktree 高亮显示（is_current=true）。
 *              操作通过 invoke 调用 Rust 后端的 worktree_* 命令。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { invoke } from '@tauri-apps/api/core';
import { useGitStore } from './gitStore';
import { useProjectStore } from './projectStore';
import type { Worktree } from '../../shared/types';

/** Worktree 面板根组件 */
export default function Worktrees() {
  const { worktrees, refreshWorktrees } = useGitStore();
  // 从当前项目获取仓库路径，未打开项目时为空字符串（此时操作会被 UI 禁用）
  const repoPath = useProjectStore((s) => s.currentProject?.path ?? '');

  /**
   * 切换到指定 worktree
   * 调用 worktree_switch_cmd，成功后刷新列表
   */
  const handleSwitch = async (wt: Worktree) => {
    if (wt.is_current) return; // 已是当前 worktree，无需切换

    try {
      await invoke('worktree_switch_cmd', { newCwd: wt.path });
      await refreshWorktrees(repoPath);
    } catch (err) {
      console.error('[Worktrees] 切换 worktree 失败:', err);
      alert(`切换失败: ${err}`);
    }
  };

  /**
   * 创建新 worktree
   * 通过 prompt 获取分支名和路径，调用 worktree_add_cmd
   */
  const handleCreate = async () => {
    const branch = window.prompt('新 worktree 分支名（不存在则自动创建）:');
    if (!branch) return;

    const path = window.prompt('新 worktree 目录路径（绝对路径）:');
    if (!path) return;

    try {
      await invoke('worktree_add_cmd', { repoPath, path, branch });
      await refreshWorktrees(repoPath);
    } catch (err) {
      console.error('[Worktrees] 创建 worktree 失败:', err);
      alert(`创建失败: ${err}`);
    }
  };

  /**
   * 删除指定 worktree
   * 弹出确认对话框后调用 worktree_remove_cmd
   */
  const handleRemove = async (wt: Worktree) => {
    if (wt.is_current) {
      alert('不能删除当前活跃的 worktree');
      return;
    }

    const confirmed = window.confirm(`确认删除 worktree "${wt.branch ?? wt.path}" ？\n路径: ${wt.path}`);
    if (!confirmed) return;

    try {
      // 使用路径作为 worktree 标识符（git worktree remove 支持路径）
      await invoke('worktree_remove_cmd', { repoPath, worktreeName: wt.path });
      await refreshWorktrees(repoPath);
    } catch (err) {
      console.error('[Worktrees] 删除 worktree 失败:', err);
      alert(`删除失败: ${err}`);
    }
  };

  return (
    <div
      data-testid="worktrees-panel"
      style={{
        height: '100%',
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        paddingTop: 4,
      }}
    >
      {/* 顶部操作栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '2px 8px 6px',
        }}
      >
        <span style={{ fontSize: 11, color: '#565f89', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Worktrees ({worktrees.length})
        </span>
        <button
          onClick={handleCreate}
          title="新建 worktree"
          style={{
            background: 'transparent',
            border: '1px solid #27293d',
            borderRadius: 3,
            color: '#7aa2f7',
            fontSize: 11,
            padding: '2px 8px',
            cursor: 'pointer',
          }}
        >
          + 新建
        </button>
      </div>

      {/* Worktree 列表 */}
      {worktrees.length === 0 ? (
        <div style={{ padding: '8px', fontSize: 12, color: '#565f89', textAlign: 'center' }}>
          暂无 worktree 数据
        </div>
      ) : (
        worktrees.map((wt) => (
          <WorktreeItem
            key={wt.path}
            wt={wt}
            onSwitch={handleSwitch}
            onRemove={handleRemove}
          />
        ))
      )}
    </div>
  );
}

/** 单个 Worktree 条目 Props */
interface WorktreeItemProps {
  wt: Worktree;
  onSwitch: (wt: Worktree) => Promise<void>;
  onRemove: (wt: Worktree) => Promise<void>;
}

/** 单个 Worktree 条目组件 */
function WorktreeItem({ wt, onSwitch, onRemove }: WorktreeItemProps) {
  // 当前活跃 worktree 使用高亮背景
  const bgColor = wt.is_current ? '#1e2030' : 'transparent';
  const borderColor = wt.is_current ? '#7aa2f7' : 'transparent';

  // 取路径最后一段作为显示名称
  const displayName = wt.branch ?? wt.path.split('/').pop() ?? wt.path;
  const shortPath = wt.path.replace(/^\/Users\/[^/]+/, '~');

  return (
    <div
      style={{
        margin: '2px 8px',
        padding: '6px 8px',
        borderRadius: 4,
        background: bgColor,
        borderLeft: `2px solid ${borderColor}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
      aria-current={wt.is_current ? 'true' : undefined}
    >
      {/* 分支名 + 当前标记 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* 分支图标（Unicode 符号，无 emoji） */}
        <span style={{ color: '#7aa2f7', fontSize: 11, fontFamily: 'monospace' }}>
          {wt.branch ? '[branch]' : '[detached]'}
        </span>
        <span style={{ color: '#c0caf5', fontSize: 12, fontWeight: wt.is_current ? 600 : 400 }}>
          {displayName}
        </span>
        {wt.is_current && (
          <span style={{ fontSize: 10, color: '#7aa2f7', marginLeft: 'auto' }}>当前</span>
        )}
      </div>

      {/* 路径 */}
      <div
        style={{ fontSize: 10, color: '#565f89', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={wt.path}
      >
        {shortPath}
      </div>

      {/* 操作按钮行 */}
      <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
        {!wt.is_current && (
          <button
            onClick={() => onSwitch(wt)}
            title={`切换到 ${displayName}`}
            style={{
              background: 'transparent',
              border: '1px solid #27293d',
              borderRadius: 3,
              color: '#7aa2f7',
              fontSize: 10,
              padding: '1px 6px',
              cursor: 'pointer',
            }}
          >
            切换
          </button>
        )}
        {!wt.is_current && (
          <button
            onClick={() => onRemove(wt)}
            title={`删除 ${displayName}`}
            style={{
              background: 'transparent',
              border: '1px solid #27293d',
              borderRadius: 3,
              color: '#f7768e',
              fontSize: 10,
              padding: '1px 6px',
              cursor: 'pointer',
            }}
          >
            删除
          </button>
        )}
      </div>
    </div>
  );
}
