/**
 * @file FeedbackInput.tsx
 * @description 反馈录入组件（Phase 7 Worker D）。
 *
 *              UI 要素（参照 plan §7.2 Step 2）：
 *                - textarea（content，必填）
 *                - select（source，5 个枚举值）
 *                - 提交按钮
 *
 *              权限：用 PermissionGate 包裹整个组件 —— 无 feedback:create 权限的
 *              用户连录入框都看不到（前端守卫；后端 RBAC 仍是真实兜底）。
 *
 *              不在本组件做：
 *              - 不做附件上传 UI：FileUploadButton 由 Worker C 提供；本 v1 简化版只录文字 +
 *                source；附件 attachmentIds 留作 props 扩展位（Phase 6 完成后再接）
 *              - 不做"提交中" loading 转圈：失败/成功用 errorByProject / 列表自动刷新感知
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { useState, type FormEvent } from 'react';

import { PERM } from '../api/permissions';
import { useFeedbacksStore } from '../stores/feedbacksStore';
import type { FeedbackSource } from '../api/feedbacks';
import { PermissionGate } from './PermissionGate';

interface FeedbackInputProps {
  /** 反馈所属项目 ID */
  projectId: number;
}

/** 反馈来源下拉值 + 中文标签（与后端 enum 对齐） */
const SOURCE_OPTIONS: Array<{ value: FeedbackSource; label: string }> = [
  { value: 'wechat', label: '微信' },
  { value: 'phone', label: '电话' },
  { value: 'email', label: '邮件' },
  { value: 'meeting', label: '面谈' },
  { value: 'other', label: '其他' },
];

export function FeedbackInput({ projectId }: FeedbackInputProps) {
  return (
    <PermissionGate perm={PERM.FEEDBACK_CREATE}>
      <FeedbackInputInner projectId={projectId} />
    </PermissionGate>
  );
}

/**
 * 拆出 Inner：让 PermissionGate 在缺权时整个组件不挂载 useState，
 * 避免登出/重新登录的瞬时 hooks 不一致。
 */
function FeedbackInputInner({ projectId }: FeedbackInputProps) {
  const [content, setContent] = useState('');
  const [source, setSource] = useState<FeedbackSource>('wechat');
  const [submitting, setSubmitting] = useState(false);

  const create = useFeedbacksStore((s) => s.create);
  const error = useFeedbacksStore((s) => s.errorByProject.get(projectId) ?? null);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    try {
      await create(projectId, { content: trimmed, source });
      // 成功后清空 content（保留 source 选择，让连续录入更顺）
      setContent('');
    } catch {
      // 错误已写入 store.errorByProject，UI 由订阅自动展示
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      data-testid="feedback-input"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 8,
        background: 'var(--c-panel)',
        borderRadius: 6,
      }}
    >
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="客户反馈内容…"
        data-testid="feedback-input-content"
        rows={3}
        style={{
          padding: '6px 8px',
          borderRadius: 4,
          border: '1px solid var(--c-border)',
          background: 'var(--c-bg)',
          color: 'var(--c-fg)',
          fontSize: 13,
          fontFamily: 'inherit',
          resize: 'vertical',
        }}
      />

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as FeedbackSource)}
          data-testid="feedback-input-source"
          style={{
            padding: '4px 6px',
            borderRadius: 4,
            border: '1px solid var(--c-border)',
            background: 'var(--c-bg)',
            color: 'var(--c-fg)',
            fontSize: 12,
          }}
        >
          {SOURCE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <button
          type="submit"
          disabled={submitting || content.trim() === ''}
          data-testid="feedback-input-submit"
          style={{
            padding: '4px 12px',
            borderRadius: 4,
            border: 'none',
            background: 'var(--c-accent)',
            color: 'var(--c-on-accent, #fff)',
            cursor: submitting || content.trim() === '' ? 'not-allowed' : 'pointer',
            fontSize: 12,
            fontWeight: 500,
            opacity: submitting || content.trim() === '' ? 0.5 : 1,
          }}
        >
          {submitting ? '提交中…' : '提交'}
        </button>
      </div>

      {error ? (
        <div
          data-testid="feedback-input-error"
          style={{ fontSize: 12, color: 'var(--c-danger, #d8453b)' }}
        >
          {error}
        </div>
      ) : null}
    </form>
  );
}
