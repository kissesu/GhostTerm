/**
 * @file FeedbackInput.tsx
 * @description 反馈录入 - textarea + source select + 提交；空内容禁用按钮
 *              source 枚举映射：UI 中文标签 → API enum 值（phone/wechat/email/meeting/other）
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { useState, type ReactElement, type FormEvent } from 'react';
import styles from '../progress.module.css';
import { useFeedbacksStore } from '../stores/feedbacksStore';
import type { FeedbackSource } from '../api/feedbacks';

// UI 标签 → API enum 值的映射表
const SOURCE_OPTIONS: { label: string; value: FeedbackSource }[] = [
  { label: '微信', value: 'wechat' },
  { label: '电话', value: 'phone' },
  { label: '邮件', value: 'email' },
  { label: '面谈', value: 'meeting' },
  { label: '其他', value: 'other' },
];

interface FeedbackInputProps {
  projectId: number;
}

export function FeedbackInput({ projectId }: FeedbackInputProps): ReactElement {
  const [content, setContent] = useState('');
  const [source, setSource] = useState<FeedbackSource>('wechat');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = useFeedbacksStore((s) => s.add);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await add(projectId, { content: content.trim(), source });
      setContent('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="客户反馈内容…"
        aria-label="反馈内容"
        style={{
          width: '100%',
          minHeight: 80,
          padding: 10,
          border: '1px solid var(--line)',
          borderRadius: 6,
          background: 'var(--bg)',
          color: 'var(--text)',
          fontFamily: 'inherit',
          fontSize: 13,
          resize: 'vertical',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as FeedbackSource)}
          aria-label="反馈来源"
          style={{
            padding: '6px 10px',
            border: '1px solid var(--line)',
            borderRadius: 6,
            background: 'var(--bg)',
            color: 'var(--text)',
            fontSize: 13,
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
          disabled={!content.trim() || submitting}
          className={styles.btnPrimary + ' ' + styles.btn}
          style={{ padding: '6px 16px', fontSize: 13 }}
        >
          {submitting ? '提交中…' : '提交'}
        </button>
        {error && (
          <span style={{ color: 'var(--red)', fontSize: 12 }}>{error}</span>
        )}
      </div>
    </form>
  );
}
