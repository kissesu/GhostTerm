/**
 * @file KanbanCard.tsx
 * @description 看板卡片极简版 - 1:1 复刻设计稿 line 171-221 + 717-728
 *              三个 meta：customer + level + deadline-tag（设计稿没有学科/紧急 chip）
 *              cardCta 全宽 outlined 绿框 + chevron 右箭头
 *              点 card 进详情；点 cardCta stopPropagation 直接弹 EventTriggerDialog（不进详情）
 *
 *              注意：Project 字段按实际 API schema 使用（name/customerLabel，非 title/customerName）
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import type { ReactElement } from 'react';
import styles from '../progress.module.css';
import type { Project } from '../api/projects';
import { getPrimaryAction, type ActionMeta } from '../config/nbaConfig';
import { daysToDeadline, formatDeadline, deadlineClass } from '../utils/deadlineCountdown';

interface KanbanCardProps {
  project: Project;
  onOpenDetail: (id: number) => void;
  onTriggerCta: (project: Project, action: ActionMeta) => void;
}

export function KanbanCard({ project, onOpenDetail, onTriggerCta }: KanbanCardProps): ReactElement {
  const days = daysToDeadline(project.deadline);
  const ddCls = deadlineClass(days);
  const ddText = formatDeadline(days);
  const primary = getPrimaryAction(project.status);

  // 根据截止日颜色级别拼接 CSS class（deadlineHot/deadlineWarm/无附加 class）
  const ddClassName =
    ddCls === 'deadlineHot'
      ? styles.deadlineTag + ' ' + styles.deadlineHot
      : ddCls === 'deadlineWarm'
        ? styles.deadlineTag + ' ' + styles.deadlineWarm
        : styles.deadlineTag;

  return (
    <div
      className={styles.card}
      data-project-id={project.id}
      onClick={() => onOpenDetail(project.id)}
      role="button"
      tabIndex={0}
    >
      {/* 项目名称 */}
      <div className={styles.cardTitle}>{project.name}</div>

      {/* meta 行：客户标签 + 学位级别 + 截止 tag */}
      <div className={styles.cardMeta}>
        <span>{project.customerLabel}</span>
        <span>{project.thesisLevel ?? '—'}</span>
        <span className={ddClassName}>{ddText}</span>
      </div>

      {/* CTA 全宽按钮：触发 NBA 主推事件，stopPropagation 阻止冒泡进详情 */}
      <button
        type="button"
        className={styles.cardCta}
        onClick={(e) => {
          e.stopPropagation();
          onTriggerCta(project, primary);
        }}
      >
        <span>{primary.label}</span>
        <svg width="12" height="12" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth={2} fill="none" />
        </svg>
      </button>
    </div>
  );
}
