/**
 * @file FeedbackList.tsx
 * @description 反馈列表 - 最新在顶（reverse byProject ASC）；空态文案
 *              source 字段回显中文标签（映射同 FeedbackInput）
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { useEffect, useMemo, type ReactElement } from 'react';
import { useFeedbacksStore } from '../stores/feedbacksStore';
import type { FeedbackSource } from '../api/feedbacks';

// source 枚举 → 中文展示标签
const SOURCE_LABEL: Record<FeedbackSource, string> = {
  wechat: '微信',
  phone: '电话',
  email: '邮件',
  meeting: '面谈',
  other: '其他',
};

interface FeedbackListProps {
  projectId: number;
}

export function FeedbackList({ projectId }: FeedbackListProps): ReactElement {
  const raw = useFeedbacksStore((s) => s.byProject.get(projectId));
  const load = useFeedbacksStore((s) => s.loadByProject);
  // byProject 存储为 ASC 时间序，reverse 后最新在顶
  const items = useMemo(() => [...(raw ?? [])].reverse(), [raw]);

  useEffect(() => {
    void load(projectId);
  }, [projectId, load]);

  if (items.length === 0) {
    return <p style={{ color: 'var(--muted)', fontSize: 13 }}>暂无反馈</p>;
  }

  return (
    <div>
      {items.map((f) => (
        <div
          key={f.id}
          style={{
            borderBottom: '1px solid var(--line)',
            padding: '10px 0',
            fontSize: 13,
          }}
        >
          <div style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 4 }}>
            {new Date(f.recordedAt).toLocaleString('zh-CN')}
            {' · '}
            {SOURCE_LABEL[f.source] ?? f.source}
          </div>
          <div>{f.content}</div>
        </div>
      ))}
    </div>
  );
}
