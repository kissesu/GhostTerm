/**
 * @file PaymentRenderer.tsx
 * @description payment 类活动渲染器：CircleDollarSign 图标 + 款项标签 + 方向/金额/备注/实际时间
 * @author Atlas.oi
 * @date 2026-05-01
 */
import type { ReactElement } from 'react';
import { CircleDollarSign } from 'lucide-react';
import type { Activity } from '../../api/activities';
import styles from '../../progress.module.css';
import { PAYMENT_DIRECTION_LABEL, formatActor, formatMoney, formatWhen } from './shared';

interface Props {
  activity: Extract<Activity, { kind: 'payment' }>;
}

export function PaymentRenderer({ activity }: Props): ReactElement {
  const actor = formatActor(activity);
  const { direction, amount, paidAt, remark } = activity.payload;
  const directionLabel = PAYMENT_DIRECTION_LABEL[direction] ?? direction;
  // 实际收款时间用本地化中文显示，与发生时间（occurredAt）做区分
  const paidAtLabel = new Date(paidAt).toLocaleString('zh-CN');
  const meta = `${remark} · 实际 ${paidAtLabel}`;

  return (
    <div className={styles.timelineItem}>
      <div className={`${styles.timelineIcon} ${styles.iconSuccess}`}>
        <CircleDollarSign size={16} />
      </div>
      <div className={styles.timelineBody}>
        <div className={styles.timelineHeader}>
          <span className={`${styles.chip} ${styles.chipSuccess}`}>款项</span>
          <span className={styles.when}>{formatWhen(activity.occurredAt)}</span>
        </div>
        <p className={styles.what}>{`${actor} 录入${directionLabel} ${formatMoney(amount)}`}</p>
        <p className={styles.meta}>{meta}</p>
      </div>
    </div>
  );
}
