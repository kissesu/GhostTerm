/**
 * @file Toast.tsx
 * @description 进度模块通知 Toast - 1:1 复刻设计稿 line 498-517
 *              slide-in/out 由 CSS .toast / .toastShow 控制；
 *              message 为 null 时返回 null（不占 DOM 位置）
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import type { ReactElement } from 'react';
import styles from '../progress.module.css';
import { useToastStore } from '../stores/toastStore';

export function Toast(): ReactElement | null {
  const message = useToastStore((s) => s.message);
  const visible = useToastStore((s) => s.visible);

  // message 为 null 时不占 DOM 位置
  if (!message) return null;

  return (
    <div
      className={styles.toast + (visible ? ' ' + styles.toastShow : '')}
      role="status"
      aria-live="polite"
    >
      <span className={styles.check}>&#10003;</span>
      <span>{message}</span>
    </div>
  );
}
