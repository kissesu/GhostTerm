/**
 * @file NbaSecondaryActions.tsx
 * @description 折叠次级动作面板 - 1:1 复刻设计稿 line 346-393 + 811-822
 *              折叠头是 <button aria-expanded>（W4 a11y）；空 actions 返回 null
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { useState, type ReactElement } from 'react';
import styles from '../progress.module.css';
import type { ActionMeta } from '../config/nbaConfig';
import type { Project } from '../api/projects';
import { canTriggerEvent } from '../utils/eventGate';
import { useGlobalAuthStore } from '../../../shared/stores/globalAuthStore';
import { useProgressPermissionStore } from '../stores/progressPermissionStore';

interface NbaSecondaryActionsProps {
  actions: readonly ActionMeta[];
  project: Pick<Project, 'holderUserId'>;
  onTrigger: (action: ActionMeta) => void;
}

export function NbaSecondaryActions({ actions, project, onTrigger }: NbaSecondaryActionsProps): ReactElement | null {
  const [open, setOpen] = useState(false);

  // holder gate：仅显示当前用户能触发的动作
  const user = useGlobalAuthStore((s) => s.user);
  const hasCancelPerm = useProgressPermissionStore((s) => s.has('progress:project:cancel'));
  const hasAfterSalesPerm = useProgressPermissionStore((s) => s.has('progress:project:after_sales'));
  const currentUser = user ? { id: user.id, roleId: user.roleId } : null;
  const visible = actions.filter((a) => canTriggerEvent(a.eventCode, project, currentUser, hasCancelPerm, hasAfterSalesPerm));

  // visible actions 为空时不渲染面板
  if (visible.length === 0) return null;

  return (
    <div className={styles.nbaSecondary + (open ? ' ' + styles.nbaSecondaryOpen : '')}>
      {/* 折叠头 - button 元素支持 aria-expanded（W4 a11y 要求） */}
      <button
        type="button"
        className={styles.nbaSecondaryHead}
        aria-expanded={open}
        aria-controls="nba-secondary-body"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.nbaSecondaryLabel}>其它操作</span>
        <span className={styles.nbaSecondaryToggle} aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 20 20">
            <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth={2} fill="none" />
          </svg>
        </span>
      </button>

      {/* 折叠体 - hidden 属性配合 CSS display:none 双保险隐藏 */}
      <div id="nba-secondary-body" className={styles.nbaSecondaryBody} hidden={!open}>
        {visible.map((a) => (
          <button
            key={a.eventCode}
            type="button"
            className={a.kind === 'critical' ? styles.nbaSecondaryItemDanger : styles.nbaSecondaryItem}
            onClick={() => onTrigger(a)}
          >
            <svg width="12" height="12" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5 10h10M10 5l5 5-5 5" stroke="currentColor" strokeWidth={2} fill="none" />
            </svg>
            <span>{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
