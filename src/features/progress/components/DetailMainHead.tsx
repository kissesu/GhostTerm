/**
 * @file DetailMainHead.tsx
 * @description 项目详情页主头部 - 1:1 复刻设计稿 line 234-290
 *              title + StatusPill 一行，4 列 metaRow：客户·学位 / 报价 / 已收 / 截止
 *              截止用 deadlineClass 上色；字段按实际 API schema（name/customerLabel）
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import type { ReactElement } from 'react';
import styles from '../progress.module.css';
import type { Project } from '../api/projects';
import { StatusPill } from './StatusPill';
import { daysToDeadline, formatDeadline, deadlineClass } from '../utils/deadlineCountdown';

interface DetailMainHeadProps {
  project: Project;
}

export function DetailMainHead({ project }: DetailMainHeadProps): ReactElement {
  const days = daysToDeadline(project.deadline);
  const ddCls = deadlineClass(days);
  const ddText = formatDeadline(days);

  // 截止日期字体颜色 class（附加到 <strong> 上）
  const ddClassName = ddCls === 'deadlineHot' ? styles.deadlineHot : ddCls === 'deadlineWarm' ? styles.deadlineWarm : '';

  return (
    <div className={styles.mainHead}>
      {/* 项目名 + 状态 pill 行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0 }}>{project.name}</h2>
        <StatusPill status={project.status} />
      </div>

      {/* 4 列 meta 数据行 */}
      <div className={styles.metaRow}>
        <div>
          <div className={styles.k}>客户</div>
          <strong>{project.customerLabel} · {project.thesisLevel ?? '—'}</strong>
        </div>
        <div>
          <div className={styles.k}>报价</div>
          <strong>¥{Number(project.currentQuote ?? 0).toLocaleString()}</strong>
        </div>
        <div>
          <div className={styles.k}>已收</div>
          <strong>¥{Number(project.totalReceived ?? 0).toLocaleString()}</strong>
        </div>
        <div>
          <div className={styles.k}>截止</div>
          <strong className={ddClassName}>{ddText}</strong>
        </div>
      </div>
    </div>
  );
}
