/**
 * @file DetailTimeline.tsx
 * @description 项目详情页活动时间线 - 渲染反馈列表（when + what + meta）
 *              最新在顶（reverse）；freshFeedbackId 高亮 2.5s 内新条目
 *              字段按实际 API schema（Feedback.recordedAt）
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import type { ReactElement } from 'react';
import styles from '../progress.module.css';
import type { Feedback } from '../api/feedbacks';

interface DetailTimelineProps {
  feedbacks: Feedback[];
  /** 刚触发事件后新建的 feedback id，用于短暂高亮 */
  freshFeedbackId?: number | null;
}

/**
 * 格式化反馈时间为可读字符串
 *
 * 规则：
 * 1. 今天 → "今天 HH:MM"
 * 2. 昨天 → "昨天"
 * 3. 其它 → "MM/DD"
 */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return `今天 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return '昨天';
  return `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`;
}

export function DetailTimeline({ feedbacks, freshFeedbackId }: DetailTimelineProps): ReactElement {
  // 最新在顶（feedbacks 来自 store 按 ASC 存储，reverse 后最新在上）
  const ordered = [...feedbacks].reverse();

  return (
    <div className={styles.timelineList}>
      {ordered.length === 0 && (
        <p style={{ color: 'var(--muted)', fontSize: 13, padding: '16px 0' }}>暂无活动</p>
      )}
      {ordered.map((f) => (
        <div
          key={f.id}
          className={
            styles.timelineItem +
            (freshFeedbackId === f.id ? ' ' + styles.timelineItemFresh : '')
          }
        >
          <span className={styles.when}>{formatWhen(f.recordedAt)}</span>
          <span className={styles.what}>
            <strong>客户反馈</strong>
            <div className={styles.meta}>{f.content}</div>
          </span>
        </div>
      ))}
    </div>
  );
}
