/**
 * @file ThesisVersionRenderer.tsx
 * @description thesis_version 类活动渲染器：FileText 图标 + 论文标签 + 版本号 + 可选 remark
 * @author Atlas.oi
 * @date 2026-05-01
 */
import type { ReactElement } from 'react';
import { FileText } from 'lucide-react';
import type { Activity } from '../../api/activities';
import styles from '../../progress.module.css';
import { formatActor, formatWhen } from './shared';

interface Props {
  activity: Extract<Activity, { kind: 'thesis_version' }>;
}

export function ThesisVersionRenderer({ activity }: Props): ReactElement {
  const actor = formatActor(activity);
  const { versionNo, remark } = activity.payload;
  // remark 为空字符串或 null 时不渲染 meta 行（避免空白条目）
  const showMeta = typeof remark === 'string' && remark.length > 0;

  return (
    <div className={styles.timelineItem}>
      <div className={`${styles.timelineIcon} ${styles.iconAccent}`}>
        <FileText size={16} />
      </div>
      <div className={styles.timelineBody}>
        <div className={styles.timelineHeader}>
          <span className={`${styles.chip} ${styles.chipAccent}`}>论文</span>
          <span className={styles.when}>{formatWhen(activity.occurredAt)}</span>
        </div>
        <p className={styles.what}>{`${actor} 上传论文 V${versionNo}`}</p>
        {showMeta ? <p className={styles.meta}>{remark}</p> : null}
      </div>
    </div>
  );
}
