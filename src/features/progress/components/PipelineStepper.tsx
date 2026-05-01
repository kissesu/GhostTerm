/**
 * @file PipelineStepper.tsx
 * @description 看板顶部 7 段 pipeline 漏斗。每段显示 stage 名 / 项目数 / 待收金额。
 *              currentStatus 提供时高亮当前段，前/后分别 done/future。
 *
 * @author Atlas.oi
 * @date 2026-04-30
 */
import type { ReactElement } from 'react';
import styles from '../progress.module.css';
import type { Project, ProjectStatus } from '../api/projects';

const PIPELINE_STAGES: ProjectStatus[] = [
  'dealing', 'quoting', 'developing', 'confirming',
  'delivered', 'paid', 'archived',
];

const STAGE_LABEL: Record<ProjectStatus, string> = {
  dealing: '洽谈',
  quoting: '报价',
  developing: '开发中',
  confirming: '验收',
  delivered: '已交付',
  paid: '已收款',
  archived: '已归档',
  after_sales: '售后',
  cancelled: '已取消',
};

interface PipelineStepperProps {
  /** 全部项目（任何 status） */
  projects: Project[];
  /** 当前选中项目的 status；缺省 = 看板态（仅按 count 决定 dim） */
  currentStatus?: ProjectStatus;
}

type StepState = 'done' | 'current' | 'future' | 'dim' | 'default';

export function PipelineStepper({ projects, currentStatus }: PipelineStepperProps): ReactElement {
  // ============================================
  // 第一步：按 stage 聚合每段的项目数 + 待收金额
  // 待收 = currentQuote - totalReceived（后端 string 字段，转 Number 相减）
  // ============================================
  const stats = PIPELINE_STAGES.map((stage) => {
    const items = projects.filter((p) => p.status === stage);
    const pending = items.reduce((sum, p) => {
      const q = Number(p.currentQuote ?? 0);
      const pd = Number(p.totalReceived ?? 0);
      return sum + (q - pd);
    }, 0);
    return { stage, count: items.length, pending };
  });

  // ============================================
  // 第二步：决定每段的视觉 state（done / current / future / dim / default）
  // ============================================
  const currentIdx = currentStatus ? PIPELINE_STAGES.indexOf(currentStatus) : -1;

  const stateOf = (idx: number, count: number): StepState => {
    if (currentIdx >= 0) {
      if (idx < currentIdx) return 'done';
      if (idx === currentIdx) return 'current';
      return 'future';
    }
    return count === 0 ? 'dim' : 'default';
  };

  return (
    <div className={styles.pipeline} role="list" aria-label="项目进度漏斗">
      {stats.map(({ stage, count, pending }, idx) => {
        const state = stateOf(idx, count);
        // dealing 段不显示金额（还没有正式报价）；空段也不显示
        const sumText = stage === 'dealing' || count === 0 ? '—' : '¥' + pending.toLocaleString();
        return (
          <div
            key={stage}
            data-testid={'pipeline-step-' + stage}
            data-state={state}
            className={styles.step}
            role="listitem"
            aria-label={STAGE_LABEL[stage] + ' ' + count + ' 单'}
          >
            <div className={styles.stepName}>{STAGE_LABEL[stage]}</div>
            <div className={styles.stepMeta}>
              <span>{count} 单</span>
              <span>{sumText}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
