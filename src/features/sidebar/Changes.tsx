/**
 * @file Changes.tsx
 * @description Git 变更面板 - 展示暂存区（Staged）和工作区（Unstaged）的文件变更列表。
 *              每个文件显示状态标记（M/A/D/?）和文件名，支持一键暂存/取消暂存操作。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { useGitStore } from './gitStore';
import type { StatusEntry } from '../../shared/types';

/** 状态标记颜色映射 - 与 FileTree git 颜色规范一致 */
const STATUS_COLORS: Record<string, string> = {
  M: '#e0af68', // 修改 - 黄色
  A: '#9ece6a', // 新增 - 绿色
  D: '#f7768e', // 删除 - 红色
  R: '#7dcfff', // 重命名 - 浅蓝
  '?': '#565f89', // 未跟踪 - 灰色
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
function FileItem({ entry, statusType, actionLabel, repoPath, onAction }: FileItemProps) {
  const color = STATUS_COLORS[statusType] ?? '#c0caf5';
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
          color: '#c0caf5',
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
          border: '1px solid #27293d',
          borderRadius: 3,
          color: '#565f89',
          fontSize: 10,
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
        fontSize: 11,
        color: '#565f89',
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
  const { changes, stageFile, unstageFile } = useGitStore();

  // 将 changes 分为 staged（有 staged 字段）和 unstaged（有 unstaged 字段）
  // 一个文件可同时出现在两个区域（部分暂存）
  const stagedEntries: Array<{ entry: StatusEntry; type: string }> = changes
    .filter((e) => e.staged != null)
    .map((e) => ({ entry: e, type: e.staged! }));

  const unstagedEntries: Array<{ entry: StatusEntry; type: string }> = changes
    .filter((e) => e.unstaged != null)
    .map((e) => ({ entry: e, type: e.unstaged! }));

  // 从 projectStore 获取仓库路径
  // 临时方案：使用空字符串占位，实际集成时从 projectStore 注入
  // TODO: PBI-6 集成时从 projectStore.currentProject.path 获取
  const repoPath = '';

  return (
    <div
      data-testid="changes-panel"
      style={{
        height: '100%',
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
          <div style={{ padding: '4px 8px', fontSize: 11, color: '#565f89' }}>
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
      <div style={{ borderTop: '1px solid #27293d', margin: '2px 0' }} />

      {/* Unstaged 分区 */}
      <div>
        <SectionHeader title="Unstaged" count={unstagedEntries.length} />
        {unstagedEntries.length === 0 ? (
          <div style={{ padding: '4px 8px', fontSize: 11, color: '#565f89' }}>
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
