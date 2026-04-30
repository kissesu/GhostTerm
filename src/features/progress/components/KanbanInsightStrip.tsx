/**
 * @file KanbanInsightStrip.tsx
 * @description 看板视图洞察横排（迁出自原 KanbanView 右侧 sidePanel）。
 *
 *              用户需求 2026-04-30：
 *              - 把"今日重点 / 阶段占比 / 人员负载"3 个 panel 从看板右侧 278px sidePanel
 *                迁到 summary 6 卡之下、看板列之上的横排区，
 *                让看板列恢复占满主区，同时 3 个 panel 同行展示更紧凑。
 *              - 仅在 currentView==='kanban' 时显示（列表/Gantt/详情下隐藏）。
 *
 *              数据派生：
 *              - 直接订阅 projectsStore，与原 sidePanelStats 计算逻辑一致；
 *                未来后端提供聚合数据时可平滑替换为 store selector。
 *
 * @author Atlas.oi
 * @date 2026-04-30
 */

import { useMemo, type ReactElement } from 'react';

import { useProjectsStore } from '../stores/projectsStore';
import { daysUntil } from '../utils/deadlineCountdown';
import styles from '../progress.module.css';

/**
 * 计算 sidePanel 三块数据：今日重点 / 阶段占比 / 人员负载。
 *
 * 业务规则（与原 KanbanView 内嵌实现一致）：
 *  - lateCount：deadline 已过 + 项目未交付/未收款/未归档
 *  - pendingQuote：处于 quoting 状态项目数
 *  - pctDev / pctQuote / pctDone：阶段占比（分母为 projects.length，避免 0 除）
 */
export function KanbanInsightStrip(): ReactElement {
  const projectsMap = useProjectsStore((s) => s.projects);
  const projects = useMemo(() => Array.from(projectsMap.values()), [projectsMap]);

  const stats = useMemo(() => {
    let lateCount = 0;
    let pendingQuote = 0;
    let inDev = 0;
    let inQuote = 0;
    let done = 0;
    for (const p of projects) {
      const days = (() => {
        try {
          return daysUntil(new Date(p.deadline));
        } catch {
          return Number.POSITIVE_INFINITY;
        }
      })();
      if (
        days < 0 &&
        p.status !== 'paid' &&
        p.status !== 'archived' &&
        p.status !== 'delivered'
      ) {
        lateCount++;
      }
      if (p.status === 'quoting') {
        pendingQuote++;
        inQuote++;
      } else if (p.status === 'developing' || p.status === 'confirming') {
        inDev++;
      } else if (p.status === 'delivered' || p.status === 'paid') {
        done++;
      }
    }
    const total = projects.length || 1;
    return {
      lateCount,
      pendingQuote,
      pctDev: Math.round((inDev / total) * 100),
      pctQuote: Math.round((inQuote / total) * 100),
      pctDone: Math.round((done / total) * 100),
    };
  }, [projects]);

  return (
    <div
      className={styles.insightStrip}
      data-testid="kanban-insight-strip"
      aria-label="看板视图洞察"
    >
      {/* 今日重点 */}
      <section className={styles.panelSection}>
        <header className={styles.panelTitle}>
          今日重点
          <span className={styles.count}>{stats.lateCount + stats.pendingQuote}</span>
        </header>
        <div className={styles.panelBody}>
          <div className={styles.miniCard}>
            <strong>超期项目</strong>
            <p>
              {stats.lateCount > 0
                ? `共 ${stats.lateCount} 个项目已超期，请优先处理`
                : '暂无超期项目'}
            </p>
          </div>
          <div className={styles.miniCard}>
            <strong>待报价</strong>
            <p>
              {stats.pendingQuote > 0
                ? `${stats.pendingQuote} 个项目停留在报价中`
                : '暂无待报价项目'}
            </p>
          </div>
        </div>
      </section>

      {/* 阶段占比 */}
      <section className={styles.panelSection}>
        <header className={styles.panelTitle}>阶段占比</header>
        <div className={styles.panelBody}>
          <div className={styles.compactRow}>
            <span>开发中</span>
            <strong>{stats.pctDev}%</strong>
          </div>
          <div className={styles.progressLine}>
            <span style={{ width: `${stats.pctDev}%` }} />
          </div>
          <div className={styles.compactRow}>
            <span>报价中</span>
            <strong>{stats.pctQuote}%</strong>
          </div>
          <div className={styles.progressLine}>
            <span style={{ width: `${stats.pctQuote}%`, background: 'var(--amber)' }} />
          </div>
          <div className={styles.compactRow}>
            <span>已完成</span>
            <strong>{stats.pctDone}%</strong>
          </div>
          <div className={styles.progressLine}>
            <span style={{ width: `${stats.pctDone}%`, background: 'var(--green)' }} />
          </div>
        </div>
      </section>

      {/* 人员负载占位：未来由后端聚合后接入 */}
      <section className={styles.panelSection}>
        <header className={styles.panelTitle}>人员负载</header>
        <div className={styles.panelBody}>
          <div className={styles.compactRow}>
            <span style={{ color: 'var(--faint)' }}>暂无聚合数据</span>
          </div>
        </div>
      </section>
    </div>
  );
}
