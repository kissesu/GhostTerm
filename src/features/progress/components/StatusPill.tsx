/**
 * @file StatusPill.tsx
 * @description 状态药丸 - 1:1 复刻设计稿 line 396-415 + 772-774
 *              data-status attr selector 驱动颜色；status-dot 圆点；文字兜底
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import type { ReactElement } from 'react';
import styles from '../progress.module.css';
import type { ProjectStatus } from '../api/projects';
import { STATUS_LABEL } from '../config/nbaConfig';

interface StatusPillProps {
  status: ProjectStatus;
}

export function StatusPill({ status }: StatusPillProps): ReactElement {
  return (
    <span className={styles.statusPill} data-status={status}>
      <span className={styles.statusDot}></span>
      {STATUS_LABEL[status]}
    </span>
  );
}
