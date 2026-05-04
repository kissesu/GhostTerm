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
import { PROJECT_STATUS_LABEL, formatWhen, formatDwellMs, parseRemarkFields } from './shared';
import { ActorChip } from './ActorChip';
import { useNow } from '../../hooks/useNow';

interface Props {
  activity: Extract<Activity, { kind: 'status_change' }>;
  /** 是否当前最新状态（最新一条 status_change 且 toStatus === project.currentStatus）。
   *  true 时显示 "已在 toLabel 停留 X"（实时差，visibilitychange/focus 触发更新）。
   *  false / undefined 显示 historical "在 fromLabel 停留 X"（固定值）。 */
  isCurrent?: boolean;
}

export function StatusChangeRenderer({ activity, isCurrent }: Props): ReactElement {
  const { fromStatus, toStatus, eventName, remark, dwellMs } = activity.payload;
  // fromStatus 可能为 null（项目首次进入状态机）→ 用 "初始" 兜底
  const fromLabel = fromStatus ? (PROJECT_STATUS_LABEL[fromStatus] ?? fromStatus) : '初始';
  const toLabel = PROJECT_STATUS_LABEL[toStatus] ?? toStatus;
  // historical dwellMs：在「fromStatus」停留时长（前一状态切换到本次切换的耗时，固定值）
  const historicalLabel = formatDwellMs(dwellMs);
  const historicalSuffix =
    historicalLabel && fromStatus ? ` · 在「${fromLabel}」停留 ${historicalLabel}` : '';
  // current dwell：最新条 + 项目仍在该状态时实时算 now - occurredAt
  // useNow hook 用 visibilitychange + focus 事件刷新，不持续 tick（用户原话"不能使用 setInterval"）
  const now = useNow();
  const currentLabel = isCurrent ? formatDwellMs(now - new Date(activity.occurredAt).getTime()) : '';
  const currentSuffix = currentLabel ? ` · 已在「${toLabel}」停留 ${currentLabel}` : '';
  // 拆解 remark：note 文字 + [fields] JSON；时间线行只展示 note，详情弹窗显示完整字段表
  const { note, fields } = parseRemarkFields(remark);
  const baseMeta = note ? `${eventName} · ${note}` : eventName;
  // current dwell 优先显示（最新条，更有用户价值）；否则 historical
  const meta = baseMeta + (currentSuffix || historicalSuffix);

  // 用户反馈 2026-05-03"开发时间线应该显示已收预付款金额(使用tag)"
  // toStatus=developing 时，从 [fields].prepayment 取金额展示 chipAccent
  const prepaymentAmount = toStatus === 'developing' ? fields.prepayment : '';
  // 用户反馈 2026-05-03"报价时间线也应该显示报价金额"
  // toStatus=quoting 时，从 [fields].estimatedAmount 取金额（与 quoting 事件 form 字段一致）
  const quotingAmount = toStatus === 'quoting' ? fields.estimatedAmount : '';

  return (
    <div className={styles.timelineItem}>
      <div className={`${styles.timelineIcon} ${styles.iconWarning}`}>
        <ArrowRightCircle size={16} />
      </div>
      <div className={styles.timelineBody}>
        <div className={styles.timelineHeader}>
          {/* chip 显示进入的目标状态名（用户原话 2026-05-03："状态 tag 应该使用实际的流程名 例如洽谈/报价/开发"） */}
          <span className={`${styles.chip} ${styles.chipWarning}`}>{toLabel}</span>
          {prepaymentAmount && (
            <span className={`${styles.chip} ${styles.chipAccent}`}>预付款 ¥{prepaymentAmount}</span>
          )}
          {quotingAmount && (
            <span className={`${styles.chip} ${styles.chipAccent}`}>¥{quotingAmount}</span>
          )}
          <ActorChip actorName={activity.actorName} actorUsername={activity.actorUsername} />
          <span className={styles.when}>{formatWhen(activity.occurredAt)}</span>
        </div>
        <p className={styles.what}>{`项目从「${fromLabel}」进入「${toLabel}」`}</p>
        <p className={styles.meta}>{meta}</p>
      </div>
    </div>
  );
}
