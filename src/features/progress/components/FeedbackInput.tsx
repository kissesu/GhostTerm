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

  const disabled = submitting || content.trim() === '';
  return (
    <form
      onSubmit={onSubmit}
      data-testid="feedback-input"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 12,
        border: '1px solid var(--line)',
        background: 'var(--panel)',
        borderRadius: 8,
      }}
    >
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="客户反馈内容…"
        data-testid="feedback-input-content"
        rows={3}
        style={{
          padding: '10px 11px',
          borderRadius: 6,
          border: '1px solid var(--line)',
          background: '#11110f',
          color: 'var(--text)',
          fontSize: 12,
          fontFamily: 'inherit',
          resize: 'vertical',
          outline: 'none',
          lineHeight: 1.55,
        }}
      />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as FeedbackSource)}
          data-testid="feedback-input-source"
          style={{
            height: 30,
            padding: '0 10px',
            borderRadius: 6,
            border: '1px solid var(--line)',
            background: '#11110f',
            color: 'var(--muted)',
            fontSize: 12,
            fontFamily: 'inherit',
            cursor: 'pointer',
            minWidth: 110,
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
          disabled={disabled}
          data-testid="feedback-input-submit"
          style={{
            height: 30,
            padding: '0 14px',
            borderRadius: 6,
            border: '1px solid transparent',
            background: 'var(--accent)',
            color: 'var(--accent-ink)',
            cursor: disabled ? 'not-allowed' : 'pointer',
            fontSize: 12,
            fontWeight: 800,
            fontFamily: 'inherit',
            opacity: disabled ? 0.55 : 1,
          }}
        >
          {submitting ? '提交中…' : '提交'}
        </button>
      </div>

      {error ? (
        <div
          data-testid="feedback-input-error"
          style={{
            padding: '6px 10px',
            border: '1px solid rgba(239, 104, 98, 0.4)',
            borderRadius: 6,
            background: 'rgba(239, 104, 98, 0.1)',
            color: '#ffd8d4',
            fontSize: 12,
          }}
        >
          {error}
        </div>
      ) : null}
    </form>
  );
}
