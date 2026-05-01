/**
 * @file ProjectCreatedRenderer.tsx
 * @description project_created 类活动渲染器：FolderPlus 图标 + 创建标签 + 初始报价
 * @author Atlas.oi
 * @date 2026-05-01
 */
import type { ReactElement } from 'react';
import { FolderPlus } from 'lucide-react';
import type { Activity } from '../../api/activities';
import styles from '../../progress.module.css';
import { formatActor, formatMoney, formatWhen } from './shared';

interface Props {
  activity: Extract<Activity, { kind: 'project_created' }>;
}

export function ProjectCreatedRenderer({ activity }: Props): ReactElement {
  const actor = formatActor(activity);
  const meta = `初始报价 ${formatMoney(activity.payload.originalQuote)}`;

  return (
    <div className={styles.timelineItem}>
      <div className={`${styles.timelineIcon} ${styles.iconAccent}`}>
        <FolderPlus size={16} />
      </div>
      <div className={styles.timelineBody}>
        <div className={styles.timelineHeader}>
          <span className={`${styles.chip} ${styles.chipAccent}`}>创建</span>
          <span className={styles.when}>{formatWhen(activity.occurredAt)}</span>
        </div>
        <p className={styles.what}>{`${actor} 创建了项目`}</p>
        <p className={styles.meta}>{meta}</p>
      </div>
    </div>
  );
}
