/**
 * @file ProjectFileRenderer.tsx
 * @description project_file_added 类活动渲染器：Paperclip 图标 + 附件标签 + 类别（无 meta）
 * @author Atlas.oi
 * @date 2026-05-01
 */
import type { ReactElement } from 'react';
import { Paperclip } from 'lucide-react';
import type { Activity } from '../../api/activities';
import styles from '../../progress.module.css';
import { PROJECT_FILE_CATEGORY_LABEL, formatActor, formatWhen } from './shared';
import { ActorChip } from './ActorChip';

interface Props {
  activity: Extract<Activity, { kind: 'project_file_added' }>;
}

export function ProjectFileRenderer({ activity }: Props): ReactElement {
  const actor = formatActor(activity);
  const categoryLabel =
    PROJECT_FILE_CATEGORY_LABEL[activity.payload.category] ?? activity.payload.category;

  return (
    <div className={styles.timelineItem}>
      <div className={`${styles.timelineIcon} ${styles.iconMuted}`}>
        <Paperclip size={16} />
      </div>
      <div className={styles.timelineBody}>
        <div className={styles.timelineHeader}>
          {/* 用户反馈 2026-05-03"源码的时间线 tag 应该显示为源码而不是附件"——chip 用 categoryLabel 动态化 */}
          <span className={`${styles.chip} ${styles.chipMuted}`}>{categoryLabel}</span>
          <ActorChip actorName={activity.actorName} actorUsername={activity.actorUsername} />
          <span className={styles.when}>{formatWhen(activity.occurredAt)}</span>
        </div>
        <p className={styles.what}>{`${actor} 上传${categoryLabel}`}</p>
      </div>
    </div>
  );
}
