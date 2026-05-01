/**
 * @file NbaSecondaryActions.tsx
 * @description NBA 折叠次级动作面板。
 *              a11y：折叠头是 <button> + aria-expanded（修 W4）
 *              actions 为空时返回 null，不渲染空壳。
 * @author Atlas.oi
 * @date 2026-04-30
 */
import { useState, type ReactElement } from 'react';
import styles from '../progress.module.css';
import type { ActionMeta } from '../config/nbaConfig';

interface NbaSecondaryActionsProps {
  actions: readonly ActionMeta[];
  /** 点击次级按钮的回调（传完整 action meta） */
  onTrigger: (action: ActionMeta) => void;
}

export function NbaSecondaryActions({ actions, onTrigger }: NbaSecondaryActionsProps): ReactElement | null {
  const [open, setOpen] = useState(false);

  // actions 为空时不渲染，避免显示无内容的折叠壳
  if (actions.length === 0) return null;

  return (
    <div className={styles.nbaSecondary + (open ? ' ' + styles.nbaSecondaryOpen : '')}>
      <button
        type="button"
        className={styles.nbaSecondaryHead}
        aria-expanded={open}
        aria-controls="nba-secondary-body"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.nbaSecondaryLabel}>其它操作</span>
        <span className={styles.nbaSecondaryToggle} aria-hidden="true">&#8964;</span>
      </button>
      <div id="nba-secondary-body" className={styles.nbaSecondaryBody} hidden={!open}>
        {actions.map((a) => (
          <button
            key={a.eventCode}
            type="button"
            className={a.kind === 'critical' ? styles.nbaSecondaryItemDanger : styles.nbaSecondaryItem}
            onClick={() => onTrigger(a)}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
