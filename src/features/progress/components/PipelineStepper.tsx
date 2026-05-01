/**
 * @file PipelineStepper.tsx
 * @description 7 段漏斗 - 1:1 复刻设计稿 line 528 + 659-696
 *              每段 chevron `>` 分隔（最末段无）；4 状态：done / current / future / dim / default
 *              currentStatus 提供时按 idx 派生 done/current/future；缺省时仅按 count 决定 dim
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import type { ReactElement } from 'react';
import styles from '../progress.module.css';
import type { Project, ProjectStatus } from '../api/projects';
import { PIPELINE_STAGES, STATUS_LABEL } from '../config/nbaConfig';

interface PipelineStepperProps {
  projects: Project[];
  currentStatus?: ProjectStatus;
}

type StepState = 'done' | 'current' | 'future' | 'dim' | 'default';

export function PipelineStepper({ projects, currentStatus }: PipelineStepperProps): ReactElement {
  // 按 PIPELINE_STAGES 7 个阶段统计项目数量 + 待收金额
  const stats = PIPELINE_STAGES.map((stage) => {
    const items = projects.filter((p) => p.status === stage);
    const pending = items.reduce((sum, p) => {
      const q = Number(p.currentQuote ?? 0);
      const pd = Number(p.totalReceived ?? 0);
      return sum + (q - pd);
    }, 0);
    return { stage, count: items.length, pending };
  });

  const currentIdx = currentStatus ? PIPELINE_STAGES.indexOf(currentStatus) : -1;

  // 按 currentStatus 派生每段状态；无 currentStatus 时按 count 判 dim
  const stateOf = (idx: number, count: number): StepState => {
    if (currentIdx >= 0) {
      if (idx < currentIdx) return 'done';
      if (idx === currentIdx) return 'current';
      return 'future';
    }
    return count === 0 ? 'dim' : 'default';
  };

  const classOf = (state: StepState): string => {
    const base = styles.step;
    if (state === 'done') return base + ' ' + styles.stepDone;
    if (state === 'current') return base + ' ' + styles.stepCurrent;
    if (state === 'future') return base + ' ' + styles.stepFuture;
    if (state === 'dim') return base + ' ' + styles.stepDim;
    return base;
  };

  return (
    <div
      className={styles.pipeline}
      role="list"
      aria-label="项目进度漏斗"
      style={{ flexShrink: 0 }} /* 避免父 flex column 挤压（上轮血泪教训） */
    >
      {stats.map(({ stage, count, pending }, idx) => {
        const state = stateOf(idx, count);
        // dealing 阶段显示"—"（无待收概念）；count=0 也显示"—"
        const sumText = stage === 'dealing' || count === 0 ? '—' : '¥' + pending.toLocaleString();
        return (
          <div
            key={stage}
            data-testid={'pipeline-step-' + stage}
            data-state={state}
            data-stage={stage}
            className={classOf(state)}
            role="listitem"
            aria-label={STATUS_LABEL[stage] + ' ' + count + ' 单'}
          >
            <div className={styles.stepName}>{STATUS_LABEL[stage]}</div>
            <div className={styles.stepMeta}>
              <span>{count} 单</span>
              <span>{sumText}</span>
            </div>
            {/* chevron 箭头 - 最末段由 CSS `.step:last-child .stepArrow { display: none }` 隐藏 */}
            <div className={styles.stepArrow} aria-hidden="true">
              <svg width="10" height="10" viewBox="0 0 20 20">
                <path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth={2} fill="none" />
              </svg>
            </div>
          </div>
        );
      })}
    </div>
  );
}
