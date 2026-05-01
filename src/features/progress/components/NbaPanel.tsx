/**
 * @file NbaPanel.tsx
 * @description NBA 主推卡片 - 1:1 复刻设计稿 line 293-344 + 797-810
 *              "★ 建议下一步" 星标 + 主标题 + reason + 大 CTA + meta(预计时长 + 事件码) + 折叠次级
 *              terminal status (archived/cancelled) → data-informational='true' 视觉弱化
 *              未知 status → fallback "未知状态" 而非崩溃
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import type { ReactElement } from 'react';
import styles from '../progress.module.css';
import type { Project } from '../api/projects';
import { NBA_CONFIG, deriveReason, type ActionMeta, type ReasonContext } from '../config/nbaConfig';
import { NbaSecondaryActions } from './NbaSecondaryActions';
import { PermissionGate } from './PermissionGate';

interface NbaPanelProps {
  project: Project;
  onTriggerAction: (action: ActionMeta) => void;
  reasonContext?: ReasonContext;
}

export function NbaPanel({ project, onTriggerAction, reasonContext }: NbaPanelProps): ReactElement {
  const cfg = NBA_CONFIG[project.status];

  // 未知 status fallback：渲染弱化容器 + 错误提示，不崩溃
  if (!cfg) {
    return (
      <div data-testid="nba-panel-fallback" className={styles.nbaInformational}>
        <div className={styles.nbaCard}>
          <div className={styles.nbaLabel}>未知状态</div>
          <p className={styles.nbaReason}>状态 "{String(project.status)}" 未配置。请联系管理员。</p>
        </div>
      </div>
    );
  }

  const reason = deriveReason(project.status, reasonContext ?? { daysSinceLastActivity: null });
  const informational = cfg.informational ?? false;
  const primary = cfg.primaryAction;

  return (
    <div
      data-testid="nba-panel"
      data-informational={informational ? 'true' : 'false'}
      className={styles.nba + (informational ? ' ' + styles.nbaInformational : '')}
    >
      <div className={styles.nbaCard}>
        {/* 标签行：★ 星标 + 状态文字 */}
        <div className={styles.nbaLabel}>
          {/* 星标 SVG（plan §1.1 informational 决策：★ 标识主推行） */}
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <path
              d="M8 1l2.5 4.5 5 1-3.5 3.5 1 5L8 12l-5 3 1-5L0.5 6.5l5-1L8 1z"
              fill="currentColor"
            />
          </svg>
          {informational ? '当前是终态' : '建议下一步'}
        </div>

        {/* 主标题 */}
        <h3>{primary.label}</h3>

        {/* reason 提示文本（可动态派生 — 见 deriveReason） */}
        <p className={styles.nbaReason}>{reason}</p>

        {/* 主推 CTA 按钮（受权限门控） */}
        <PermissionGate perm={primary.permCode}>
          <button
            type="button"
            data-testid="nba-cta"
            className={styles.nbaCta}
            onClick={() => onTriggerAction(primary)}
          >
            <span>{primary.label}</span>
            <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth={2} fill="none" />
            </svg>
          </button>
        </PermissionGate>

        {/* meta 行：预计时长 + 事件码 */}
        <div className={styles.nbaMeta}>
          <span>{primary.meta}</span>
          <span>事件 {primary.eventCode}</span>
        </div>
      </div>

      {/* 折叠次级动作面板 */}
      <NbaSecondaryActions actions={cfg.secondary} onTrigger={onTriggerAction} />
    </div>
  );
}
