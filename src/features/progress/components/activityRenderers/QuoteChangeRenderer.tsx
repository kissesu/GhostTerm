/**
 * @file QuoteChangeRenderer.tsx
 * @description quote_change 类活动渲染器：Calculator 图标 + 报价标签 + 类型/差额/新报价/原因
 * @author Atlas.oi
 * @date 2026-05-01
 */
import type { ReactElement } from 'react';
import { Calculator } from 'lucide-react';
import type { Activity } from '../../api/activities';
import styles from '../../progress.module.css';
import { QUOTE_CHANGE_TYPE_LABEL, formatActor, formatMoney, formatWhen } from './shared';

interface Props {
  activity: Extract<Activity, { kind: 'quote_change' }>;
}

export function QuoteChangeRenderer({ activity }: Props): ReactElement {
  const actor = formatActor(activity);
  const { changeType, delta, newQuote, reason } = activity.payload;
  const typeLabel = QUOTE_CHANGE_TYPE_LABEL[changeType] ?? changeType;
  const meta = `${typeLabel} ${formatMoney(delta)} · 新报价 ${formatMoney(newQuote)} · ${reason}`;

  return (
    <div className={styles.timelineItem}>
      <div className={`${styles.timelineIcon} ${styles.iconWarning}`}>
        <Calculator size={16} />
      </div>
      <div className={styles.timelineBody}>
        <div className={styles.timelineHeader}>
          <span className={`${styles.chip} ${styles.chipWarning}`}>报价</span>
          <span className={styles.when}>{formatWhen(activity.occurredAt)}</span>
        </div>
        <p className={styles.what}>{`${actor} 调整了报价`}</p>
        <p className={styles.meta}>{meta}</p>
      </div>
    </div>
  );
}
