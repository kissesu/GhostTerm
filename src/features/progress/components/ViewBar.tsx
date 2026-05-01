/**
 * @file ViewBar.tsx
 * @description 看板/详情 视图切换条 - 1:1 复刻设计稿 line 104-136 + 857-865
 *              kanban 模式：crumb "看板 · X 单进行中"
 *              detail 模式：crumb "看板 / 项目名" + 右侧返回按钮
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import type { ReactElement } from 'react';
import styles from '../progress.module.css';

interface ViewBarProps {
  mode: 'kanban' | 'detail';
  /** kanban 模式时显示 "X 单进行中" */
  activeProjectCount?: number;
  /** detail 模式时显示项目名 */
  projectTitle?: string;
  /** detail 模式时点返回 */
  onBack?: () => void;
}

export function ViewBar({ mode, activeProjectCount, projectTitle, onBack }: ViewBarProps): ReactElement {
  return (
    <div className={styles.viewBar}>
      <div className={styles.crumb}>
        {mode === 'kanban' ? (
          <>
            <span className={styles.leaf}>看板</span>
            <span className={styles.sep}>·</span>
            <span>{activeProjectCount ?? 0} 单进行中</span>
          </>
        ) : (
          <>
            {/* detail 模式：面包屑 "看板 / 项目名" */}
            <a onClick={onBack} role="button" tabIndex={0}>看板</a>
            <span className={styles.sep}>/</span>
            <span className={styles.leaf}>{projectTitle ?? ''}</span>
          </>
        )}
      </div>
      {/* 返回按钮仅 detail 模式 + onBack 提供时渲染 */}
      {mode === 'detail' && onBack && (
        <button className={styles.backBtn} type="button" onClick={onBack}>
          <svg width="12" height="12" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M13 4l-6 6 6 6" stroke="currentColor" strokeWidth={2} fill="none" />
          </svg>
          返回看板
        </button>
      )}
    </div>
  );
}
