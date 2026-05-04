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
import { formatActor, formatWhen, summarizeAttachmentCategories } from './shared';
import { ActorChip } from './ActorChip';

interface Props {
  activity: Extract<Activity, { kind: 'feedback' }>;
}

export function FeedbackRenderer({ activity }: Props): ReactElement {
  const actor = formatActor(activity);
  const attachmentCount = activity.payload.attachmentCount;
  // 媒体/文档两类聚合（用户反馈 2026-05-03"进度功能模块应该只有两类文件"），0 时不显示
  const categorySummary = summarizeAttachmentCategories(activity.payload.attachments);
  const attachmentSuffix = attachmentCount > 0
    ? ` · 含 ${attachmentCount} 个附件${categorySummary ? `（${categorySummary}）` : ''}`
    : '';

  return (
    <div className={styles.timelineItem}>
      <div className={`${styles.timelineIcon} ${styles.iconMuted}`}>
        <MessageSquare size={16} />
      </div>
      <div className={styles.timelineBody}>
        <div className={styles.timelineHeader}>
          <span className={`${styles.chip} ${styles.chipMuted}`}>反馈</span>
          <ActorChip actorName={activity.actorName} actorUsername={activity.actorUsername} />
          <span className={styles.when}>{formatWhen(activity.occurredAt)}</span>
        </div>
        <p className={styles.what}>{`${actor} 提交反馈${attachmentSuffix}`}</p>
        <p className={styles.meta}>{activity.payload.content}</p>
      </div>
    </div>
  );
}
