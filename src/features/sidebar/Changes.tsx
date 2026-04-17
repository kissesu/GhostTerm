/**
 * @file Changes.tsx
 * @description Git 变更面板 - 展示暂存区（Staged）和工作区（Unstaged）的文件变更列表。
 *              每个文件显示状态标记（M/A/D/?）和文件名，支持一键暂存/取消暂存操作。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { useEffect } from 'react';
import { useGitStore } from './gitStore';
import { useProjectStore } from './projectStore';
import type { StatusEntry } from '../../shared/types';

// Changes 面板轮询间隔（ms）：终端执行 git 操作后能在 3 秒内反映到面板
const POLL_INTERVAL_MS = 3000;

/** 状态标记颜色映射 - 使用设计系统 --c-git-* 语义 token，跟随主题 */
const STATUS_COLORS: Record<string, string> = {
  M: 'var(--c-git-modified)',
  A: 'var(--c-git-added)',
  D: 'var(--c-git-deleted)',
  R: 'var(--c-git-renamed)',
  '?': 'var(--c-git-untracked)',
};

/** 状态标记文字提示 */
const STATUS_LABELS: Record<string, string> = {
  M: '修改',
  A: '新增',
  D: '删除',
  R: '重命名',
  '?': '未跟踪',
};

/** 单个文件条目 Props */
interface FileItemProps {
  entry: StatusEntry;
  /** 显示的状态类型（staged 或 unstaged） */
  statusType: string;
  /** 按钮动作文字 */
  actionLabel: string;
  /** 仓库路径（用于执行 stage/unstage） */
  repoPath: string;
  /** 点击按钮时的回调 */
  onAction: (filePath: string) => Promise<void>;
}

/** 单个文件变更条目 */
function FileItem({ entry, statusType, actionLabel, onAction }: FileItemProps) {
  const color = STATUS_COLORS[statusType] ?? 'var(--c-fg)';
  const label = STATUS_LABELS[statusType] ?? statusType;

  // 取文件名（最后一段路径）用于展示，完整路径作为 title
  const fileName = entry.path.split('/').pop() ?? entry.path;

  const handleAction = async () => {
    try {
      await onAction(entry.path);
    } catch (err) {
      console.error(`[Changes] ${actionLabel} 失败:`, err);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '2px 8px',
        gap: 6,
        fontSize: 12,
      }}
    >
      {/* 状态标记（M/A/D/?） */}
      <span
        style={{ color, fontWeight: 600, width: 14, flexShrink: 0, fontFamily: 'monospace' }}
        title={label}
        aria-label={label}
      >
        {statusType}
      </span>

      {/* 文件名 */}
      <span
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: 'var(--c-fg)',
        }}
        title={entry.path}
      >
        {fileName}
      </span>

      {/* 操作按钮 */}
      <button
        onClick={handleAction}
        title={`${actionLabel} ${entry.path}`}
        style={{
          background: 'transparent',
          border: '1px solid var(--c-border-sub)',
          borderRadius: 3,
          color: 'var(--c-fg-subtle)',
          fontSize: 11,
          padding: '1px 5px',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        {actionLabel}
      </button>
    </div>
  );
}

/** 分区标题 */
function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div
      style={{
        padding: '4px 8px 2px',
        fontSize: 12,
        color: 'var(--c-fg-subtle)',
        fontWeight: 600,
        letterSpacing: 0.5,
        textTransform: 'uppercase',
      }}
    >
      {title} ({count})
    </div>
  );
}

/** Git 变更面板根组件 */
export default function Changes() {
  const { changes, stageFile, unstageFile, refreshGitStatus } = useGitStore();

  // 从当前项目获取仓库路径
  const repoPath = useProjectStore((s) => s.currentProject?.path ?? '');

  // ============================================
  // 轮询刷新：挂载时立即刷新一次，之后每 3 秒轮询
  // 确保在终端执行 git commit/pull 等操作后能自动同步
  // 组件随 tab 切换 unmount 时定时器自动清理，不后台空跑
  // ============================================
  useEffect(() => {
    if (!repoPath) return;
    refreshGitStatus(repoPath);
    const timer = setInterval(() => refreshGitStatus(repoPath), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [repoPath, refreshGitStatus]);

  // 将 changes 分为 staged（有 staged 字段）和 unstaged（有 unstaged 字段）
  // 一个文件可同时出现在两个区域（部分暂存）
  const stagedEntries: Array<{ entry: StatusEntry; type: string }> = changes
    .filter((e) => e.staged != null)
    .map((e) => ({ entry: e, type: e.staged! }));

  const unstagedEntries: Array<{ entry: StatusEntry; type: string }> = changes
    .filter((e) => e.unstaged != null)
    .map((e) => ({ entry: e, type: e.unstaged! }));

  return (
    <div
      data-testid="changes-panel"
      style={{
        width: '100%',
        height: '100%',
        minWidth: 0,
        minHeight: 0,
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        paddingTop: 4,
      }}
    >
      {/* Staged 分区 */}
      <div>
        <SectionHeader title="Staged" count={stagedEntries.length} />
        {stagedEntries.length === 0 ? (
          <div style={{ padding: '4px 8px', fontSize: 12, color: 'var(--c-fg-subtle)' }}>
            无暂存文件
          </div>
        ) : (
          stagedEntries.map(({ entry, type }) => (
            <FileItem
              key={`staged-${entry.path}`}
              entry={entry}
              statusType={type}
              actionLabel="Unstage"
              repoPath={repoPath}
              onAction={(fp) => unstageFile(repoPath, fp)}
            />
          ))
        )}
      </div>

      {/* 分隔线 */}
      <div style={{ borderTop: '1px solid var(--c-border-sub)', margin: '2px 0' }} />

      {/* Unstaged 分区 */}
      <div>
        <SectionHeader title="Unstaged" count={unstagedEntries.length} />
        {unstagedEntries.length === 0 ? (
          <div style={{ padding: '4px 8px', fontSize: 12, color: 'var(--c-fg-subtle)' }}>
            无未暂存文件
          </div>
        ) : (
          unstagedEntries.map(({ entry, type }) => (
            <FileItem
              key={`unstaged-${entry.path}`}
              entry={entry}
              statusType={type}
              actionLabel="Stage"
              repoPath={repoPath}
              onAction={(fp) => stageFile(repoPath, fp)}
            />
          ))
        )}
      </div>
    </div>
  );
}
