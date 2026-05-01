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

interface NbaSecondaryActionsProps {
  actions: readonly ActionMeta[];
  onTrigger: (action: ActionMeta) => void;
}

export function NbaSecondaryActions({ actions, onTrigger }: NbaSecondaryActionsProps): ReactElement | null {
  const [open, setOpen] = useState(false);

  // actions 为空时不渲染面板
  if (actions.length === 0) return null;

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
        {actions.map((a) => (
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
