/**
 * @file FeedbackRenderer.tsx
 * @description feedback 类活动渲染器：MessageSquare 图标 + 反馈标签 + 来源 + 内容
 * @author Atlas.oi
 * @date 2026-05-01
 */
import type { ReactElement } from 'react';
import { MessageSquare } from 'lucide-react';
import type { Activity } from '../../api/activities';
import styles from '../../progress.module.css';
import { FEEDBACK_SOURCE_LABEL, formatActor, formatWhen } from './shared';

interface Props {
  activity: Extract<Activity, { kind: 'feedback' }>;
}

export function FeedbackRenderer({ activity }: Props): ReactElement {
  const actor = formatActor(activity);
  const sourceLabel = FEEDBACK_SOURCE_LABEL[activity.payload.source] ?? activity.payload.source;

  return (
    <div className={styles.timelineItem}>
      <div className={`${styles.timelineIcon} ${styles.iconMuted}`}>
        <MessageSquare size={16} />
      </div>
      <div className={styles.timelineBody}>
        <div className={styles.timelineHeader}>
          <span className={`${styles.chip} ${styles.chipMuted}`}>反馈</span>
          <span className={styles.when}>{formatWhen(activity.occurredAt)}</span>
        </div>
        <p className={styles.what}>{`${actor} 提交反馈（${sourceLabel}）`}</p>
        <p className={styles.meta}>{activity.payload.content}</p>
      </div>
    </div>
  );
}
