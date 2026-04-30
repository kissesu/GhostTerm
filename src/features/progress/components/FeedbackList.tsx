/**
 * @file FeedbackList.tsx
 * @description 反馈列表组件（Phase 7 Worker D）。
 *
 *              UI 要素：
 *                - 滚动列表，每条反馈一行
 *                - 状态徽章（pending / done）
 *                - 录入时间 + 来源 + 内容
 *                - 操作按钮："标为已处理"（仅 pending 时显示）
 *
 *              首次挂载时 useEffect 触发 store.load(projectId) 拉取列表；
 *              切换 projectId 时再次触发。
 *
 *              语义边界：
 *              - 不做"附件预览"：附件 file_id 列表已在 Feedback.attachmentIds，
 *                附件浏览器交给 FileViewer（Worker C）；本组件只显示数量徽章
 *              - 不做无限滚动 / 分页：v1 单项目反馈量预计 < 100 条，全部加载
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { useEffect, useMemo } from 'react';

import { PERM } from '../api/permissions';
import { useFeedbacksStore } from '../stores/feedbacksStore';
import { usePermission } from '../hooks/usePermission';
import type { Feedback } from '../api/feedbacks';

interface FeedbackListProps {
  projectId: number;
}

/** 来源中文映射，与 FeedbackInput 对齐 */
const SOURCE_LABEL: Record<Feedback['source'], string> = {
  phone: '电话',
  wechat: '微信',
  email: '邮件',
  meeting: '面谈',
  other: '其他',
};

// 模块级稳定空数组：当 byProject.get(projectId) 为 undefined 时总返回同一引用，
// 避免 React 19 useSyncExternalStore 报 "Maximum update depth exceeded"
// （feedback_react19_zustand5_selector_stable_ref：selector 必须返回稳定引用）
const EMPTY_FEEDBACKS: readonly Feedback[] = Object.freeze([]);

export function FeedbackList({ projectId }: FeedbackListProps) {
  // 选 Map 引用（稳定），useMemo 内做 .get 兜底——避免 selector 每次创建新数组
  const byProject = useFeedbacksStore((s) => s.byProject);
  const list = useMemo(
    () => byProject.get(projectId) ?? (EMPTY_FEEDBACKS as Feedback[]),
    [byProject, projectId],
  );
  const loadingByProject = useFeedbacksStore((s) => s.loadingByProject);
  const loading = useMemo(() => loadingByProject.has(projectId), [loadingByProject, projectId]);
  const errorByProject = useFeedbacksStore((s) => s.errorByProject);
  const error = useMemo(() => errorByProject.get(projectId) ?? null, [errorByProject, projectId]);
  const load = useFeedbacksStore((s) => s.load);

  // 项目切换 / 首次挂载时加载
  useEffect(() => {
    void load(projectId).catch(() => {
      // 错误已写入 store.errorByProject，避免 unhandled rejection
    });
  }, [projectId, load]);

  if (loading && list.length === 0) {
    return (
      <div data-testid="feedback-list-loading" style={{ padding: 12, fontSize: 12, color: 'var(--muted)' }}>
        加载反馈中…
      </div>
    );
  }

  if (error && list.length === 0) {
    return (
      <div
        data-testid="feedback-list-error"
        style={{
          padding: '8px 12px',
          border: '1px solid rgba(239, 104, 98, 0.4)',
          borderRadius: 6,
          background: 'rgba(239, 104, 98, 0.1)',
          color: '#ffd8d4',
          fontSize: 12,
        }}
      >
        加载失败：{error}
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div data-testid="feedback-list-empty" style={{ padding: 12, fontSize: 12, color: 'var(--faint)' }}>
        暂无反馈
      </div>
    );
  }

  return (
    <ul
      data-testid="feedback-list"
      style={{
        listStyle: 'none',
        padding: 0,
        margin: 0,
        overflowY: 'auto',
        minHeight: 0,
        flex: 1,
        border: '1px solid var(--line)',
        borderRadius: 8,
        background: 'var(--panel)',
      }}
    >
      {list.map((fb) => (
        <FeedbackItem key={fb.id} feedback={fb} />
      ))}
    </ul>
  );
}

/**
 * 单条反馈渲染。
 * 拆为子组件的原因：每行都用一次 usePermission，避免在父组件内 .map() 调 hook
 * 违反 React Hooks 规则。
 */
function FeedbackItem({ feedback }: { feedback: Feedback }) {
  const updateStatus = useFeedbacksStore((s) => s.updateStatus);
  // "标为已处理"复用 feedback:create 权限码（与后端 handler 处一致；migration 未引入 update perm）
  const canResolve = usePermission(PERM.FEEDBACK_CREATE);

  const isDone = feedback.status === 'done';
  const recordedAt = new Date(feedback.recordedAt).toLocaleString();

  const onMarkDone = () => {
    void updateStatus(feedback.id, 'done').catch(() => {
      // 错误展示由父组件 errorByProject 订阅
    });
  };

  return (
    <li
      data-testid={`feedback-item-${feedback.id}`}
      data-status={feedback.status}
      style={{
        padding: '10px 14px',
        borderBottom: '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 500 }}>
        <StatusBadge status={feedback.status} />
        <span style={{ color: 'var(--faint)' }}>{recordedAt}</span>
        <span style={{ color: 'var(--faint)' }}>· {SOURCE_LABEL[feedback.source]}</span>
        {feedback.attachmentIds && feedback.attachmentIds.length > 0 ? (
          <span
            data-testid={`feedback-item-${feedback.id}-attachments`}
            style={{ color: 'var(--faint)', fontSize: 11 }}
          >
            · {feedback.attachmentIds.length} 个附件
          </span>
        ) : null}
      </div>

      <div
        style={{
          fontSize: 13,
          color: 'var(--text)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          lineHeight: 1.55,
        }}
      >
        {feedback.content}
      </div>

      {!isDone && canResolve ? (
        <div>
          <button
            type="button"
            onClick={onMarkDone}
            data-testid={`feedback-item-${feedback.id}-mark-done`}
            style={{
              height: 24,
              padding: '0 10px',
              borderRadius: 5,
              border: '1px solid var(--line)',
              background: 'var(--panel-2)',
              color: 'var(--muted)',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 700,
              fontFamily: 'inherit',
            }}
          >
            标为已处理
          </button>
        </div>
      ) : null}
    </li>
  );
}

/** 状态徽章：pending（黄色） / done（绿色） —— 用 habitat tokens */
function StatusBadge({ status }: { status: Feedback['status'] }) {
  const isDone = status === 'done';
  return (
    <span
      data-testid="feedback-status-badge"
      data-status={status}
      style={{
        padding: '2px 7px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.2,
        background: isDone ? 'rgba(121, 209, 124, 0.16)' : 'rgba(231, 186, 74, 0.18)',
        color: isDone ? '#d7ffd8' : '#ffe7aa',
      }}
    >
      {isDone ? '已处理' : '待处理'}
    </span>
  );
}
