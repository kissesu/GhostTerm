/**
 * @file NbaPanel.tsx
 * @description Next Best Action 右栏主面板。
 *              替代旧 EventActionButtons（13 并列事件按钮）。
 *
 *              组成：
 *              - 主推 CTA（按 NBA_CONFIG[status].primaryAction 渲染）
 *              - reason 文案（deriveReason 派生）
 *              - 折叠次级动作（NbaSecondaryActions）
 *
 *              terminal status (archived / cancelled)：
 *              - data-informational="true"，视觉弱化
 *              - CTA 仍渲染（"客户报售后" / "重启取消"）但 hint 文案表达"非主推"
 *
 * @author Atlas.oi
 * @date 2026-04-30
 */
import type { ReactElement } from 'react';
import styles from '../progress.module.css';
import type { Project } from '../api/projects';
import { NBA_CONFIG, deriveReason, type ActionMeta, type ReasonContext } from '../config/nbaConfig';
import { NbaSecondaryActions } from './NbaSecondaryActions';
import { PermissionGate } from './PermissionGate';

interface NbaPanelProps {
  project: Project;
  /** 点击主 CTA 或次级动作时的回调；caller 负责打开 EventTriggerDialog */
  onTriggerAction: (action: ActionMeta) => void;
  /** reason 派生上下文；缺省传 null 时使用 defaultReason */
  reasonContext?: ReasonContext;
}

export function NbaPanel({ project, onTriggerAction, reasonContext }: NbaPanelProps): ReactElement {
  const cfg = NBA_CONFIG[project.status];

  // 未知 status 降级：返回友好提示而非崩溃（W2）
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
  // informational 为 true 时视觉弱化：archived / cancelled 终态
  const informational = cfg.informational ?? false;
  const primary = cfg.primaryAction;

  return (
    <div
      data-testid="nba-panel"
      data-informational={informational ? 'true' : 'false'}
      className={informational ? styles.nbaInformational : styles.nba}
    >
      <div className={styles.nbaCard}>
        {/* 语义标签：告知用户当前卡片的意图 */}
        <div className={styles.nbaLabel}>
          {informational ? '当前是终态' : '建议下一步'}
        </div>

        <h3 className={styles.nbaTitle}>{primary.label}</h3>
        <p className={styles.nbaReason}>{reason}</p>

        {/* 主 CTA 受权限守卫保护 */}
        <PermissionGate perm={primary.permCode}>
          <button
            type="button"
            data-testid="nba-cta"
            className={styles.nbaCta}
            onClick={() => onTriggerAction(primary)}
          >
            {primary.label}
          </button>
        </PermissionGate>

        {/* 显示事件码方便排查和调试 */}
        <div className={styles.nbaMeta}>
          <span>事件 {primary.eventCode}</span>
        </div>
      </div>

      {/* 次级动作：secondary 为空时 NbaSecondaryActions 自返回 null */}
      <NbaSecondaryActions actions={cfg.secondary} onTrigger={onTriggerAction} />
    </div>
  );
}
