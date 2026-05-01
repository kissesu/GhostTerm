/**
 * @file StatusChangeRenderer.tsx
 * @description status_change 类活动渲染器：ArrowRightCircle 图标 + 状态标签 + from→to + 事件名/备注
 * @author Atlas.oi
 * @date 2026-05-01
 */
import type { ReactElement } from 'react';
import { ArrowRightCircle } from 'lucide-react';
import type { Activity } from '../../api/activities';
import styles from '../../progress.module.css';
import { PROJECT_STATUS_LABEL, formatWhen } from './shared';

interface Props {
  activity: Extract<Activity, { kind: 'status_change' }>;
}

export function StatusChangeRenderer({ activity }: Props): ReactElement {
  const { fromStatus, toStatus, eventName, remark } = activity.payload;
  // fromStatus 可能为 null（项目首次进入状态机）→ 用 "初始" 兜底
  const fromLabel = fromStatus ? (PROJECT_STATUS_LABEL[fromStatus] ?? fromStatus) : '初始';
  const toLabel = PROJECT_STATUS_LABEL[toStatus] ?? toStatus;
  const meta = remark ? `${eventName} · ${remark}` : eventName;

  return (
    <div className={styles.timelineItem}>
      <div className={`${styles.timelineIcon} ${styles.iconWarning}`}>
        <ArrowRightCircle size={16} />
      </div>
      <div className={styles.timelineBody}>
        <div className={styles.timelineHeader}>
          <span className={`${styles.chip} ${styles.chipWarning}`}>状态</span>
          <span className={styles.when}>{formatWhen(activity.occurredAt)}</span>
        </div>
        <p className={styles.what}>{`项目从「${fromLabel}」进入「${toLabel}」`}</p>
        <p className={styles.meta}>{meta}</p>
      </div>
    </div>
  );
}
