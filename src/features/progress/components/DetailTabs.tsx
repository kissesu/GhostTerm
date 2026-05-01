/**
 * @file DetailTabs.tsx
 * @description 项目详情页 tabs 导航 - 5 tabs：活动时间线 / 反馈 / 论文版本 / 文件 / 收款
 *              active state 用 tabBtnActive class；role=tablist + role=tab + aria-selected a11y
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import type { ReactElement } from 'react';
import styles from '../progress.module.css';

export type DetailTab = 'timeline' | 'feedback' | 'thesis' | 'files' | 'payments';

/** 5 个 tab 的固定定义（顺序按设计稿 §1.3） */
const TABS: ReadonlyArray<{ id: DetailTab; label: string }> = [
  { id: 'timeline', label: '活动时间线' },
  { id: 'feedback', label: '反馈' },
  { id: 'thesis', label: '论文版本' },
  { id: 'files', label: '文件' },
  { id: 'payments', label: '收款' },
];

interface DetailTabsProps {
  active: DetailTab;
  onChange: (tab: DetailTab) => void;
}

export function DetailTabs({ active, onChange }: DetailTabsProps): ReactElement {
  return (
    <div className={styles.tabs} role="tablist">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          className={active === t.id ? styles.tabBtn + ' ' + styles.tabBtnActive : styles.tabBtn}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
