/**
 * @file GanttView.tsx
 * @description 进度模块 Gantt 视图（设计稿 §03 Gantt视图）。
 *
 *              业务背景（设计稿 1:1 复刻）：
 *              - 左侧 260px：项目名 + 负责人列
 *              - 右侧 14 列时间轴（从今日开始 14 天）+ 每个项目一个色彩条
 *              - 颜色按状态：
 *                  · dealing → accent（绿）
 *                  · quoting → amber
 *                  · developing → cyan
 *                  · 已超期 → red
 *                  · delivered/paid → green
 *              - 横条位置：
 *                  · left%   = clamp((dealingAt - today) / 14, 0, 1) * 100
 *                  · width%  = clamp((deadline - max(dealingAt, today)) / 14, 0.04, 1) * 100
 *                  · 至少 4% 宽度让条始终可见
 *
 *              过滤：
 *              - statusFilter / searchQuery 复用 progressUiStore
 *              - 仅展示活跃 + 已完成项目（exclude archived/cancelled）
 *
 *              点击：
 *              - 点击横条或左侧行 → setSelectedProject 跳详情
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { useEffect, useMemo, type ReactElement } from 'react';

import { useProjectsStore } from '../stores/projectsStore';
import { useProgressUiStore } from '../stores/progressUiStore';
import type { Project, ProjectStatus } from '../api/projects';
import { daysUntil } from '../utils/deadlineCountdown';
import styles from '../progress.module.css';

/** 时间窗口宽度（与设计稿 14 列一致） */
const TIMELINE_DAYS = 14;

/**
 * 状态 → 横条样式 class 名映射。
 *
 * 业务规则：
 *  - 已超期（deadline < today）一律 late（红）
 *  - 否则按 status 选择 quote/dev/done/默认 accent
 */
function barClassFor(status: ProjectStatus, isLate: boolean): string {
  if (isLate && status !== 'delivered' && status !== 'paid' && status !== 'archived') {
    return styles.barLate;
  }
  switch (status) {
    case 'quoting':
      return styles.barQuote;
    case 'developing':
    case 'confirming':
      return styles.barDev;
    case 'delivered':
    case 'paid':
      return styles.barDone;
    default:
      return ''; // 默认 accent（CSS 中 .bar 自带）
  }
}

/**
 * 计算横条左偏移 + 宽度（百分比）。
 *
 * 业务规则：
 *  - 起点 = 项目 dealingAt，超出"今天"则截到今天（左对齐到 0%）
 *  - 终点 = deadline，超出 14 天窗口则截到 14
 *  - 最小宽度 4% 保底显示
 */
function barGeometry(project: Project, today: Date): { left: number; width: number } {
  const start = new Date(project.dealingAt);
  const end = new Date(project.deadline);
  const startDays = daysUntil(start, today);
  const endDays = daysUntil(end, today);

  // 超出窗口（已结束 / 还没开始太远）→ 仍画到边界
  const leftClamped = Math.max(0, Math.min(TIMELINE_DAYS, startDays * -1)) * 0; // 起点偏移用 max(0, ...)
  // 起点：dealingAt 在过去 → 0%；在未来 → startDays / 14
  const leftPct = Math.max(0, Math.min(TIMELINE_DAYS, startDays >= 0 ? startDays : 0));
  // 终点：deadline 在窗口内 → endDays；超过 → 14
  const rightPct = Math.max(0, Math.min(TIMELINE_DAYS, endDays >= 0 ? endDays + 1 : 0));
  const left = (leftPct / TIMELINE_DAYS) * 100;
  const widthRaw = ((rightPct - leftPct) / TIMELINE_DAYS) * 100;
  const width = Math.max(4, widthRaw); // 至少 4%
  void leftClamped;
  return { left, width };
}

/**
 * 把 holder 角色/用户 id 渲染为简短字符串（与列表视图一致）。
 */
function formatHolder(
  roleId: number | null | undefined,
  userId: number | null | undefined,
): string {
  if (userId != null) return `@u${userId}`;
  if (roleId != null) return `[role${roleId}]`;
  return '—';
}

/**
 * 生成 14 天时间轴顶部的日期标签（"04/29" 风格）。
 */
function buildTimelineLabels(today: Date): string[] {
  const labels: string[] = [];
  for (let i = 0; i < TIMELINE_DAYS; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    labels.push(`${m}/${day}`);
  }
  return labels;
}

export function GanttView(): ReactElement {
  const projectsMap = useProjectsStore((s) => s.projects);
  const projectsLoading = useProjectsStore((s) => s.loading);
  const loadProjects = useProjectsStore((s) => s.load);
  const projects = useMemo(() => Array.from(projectsMap.values()), [projectsMap]);

  const searchQuery = useProgressUiStore((s) => s.searchQuery);
  const statusFilter = useProgressUiStore((s) => s.statusFilter);
  const setSelectedProject = useProgressUiStore((s) => s.setSelectedProject);

  useEffect(() => {
    void loadProjects().catch(() => {});
  }, [loadProjects]);

  // today 一次确定（避免每次 render 偏移）
  const today = useMemo(() => new Date(), []);
  const labels = useMemo(() => buildTimelineLabels(today), [today]);

  // 过滤 + 排序：deadline ASC
  const filtered = useMemo(() => {
    const lowered = searchQuery.trim().toLowerCase();
    return projects
      .filter((p) => {
        if (p.status === 'archived' || p.status === 'cancelled') return false;
        if (statusFilter !== 'all' && p.status !== statusFilter) return false;
        if (lowered === '') return true;
        return (
          p.name.toLowerCase().includes(lowered) ||
          p.customerLabel.toLowerCase().includes(lowered)
        );
      })
      .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
  }, [projects, statusFilter, searchQuery]);

  if (projectsLoading && projects.length === 0) {
    return (
      <div className={styles.emptyState} data-testid="gantt-loading">
        加载项目中…
      </div>
    );
  }

  return (
    <div className={styles.viewPanel} data-testid="gantt-view">
      <header className={styles.viewHead}>
        <div className={styles.viewTitle}>
          <code>03</code>Gantt视图
        </div>
        <div className={styles.legend}>
          <span>
            <i />
            洽谈
          </span>
          <span>
            <i style={{ background: 'var(--amber)' }} />
            报价
          </span>
          <span>
            <i style={{ background: 'var(--cyan)' }} />
            开发
          </span>
          <span>
            <i style={{ background: 'var(--red)' }} />
            超期
          </span>
        </div>
      </header>

      {filtered.length === 0 ? (
        <div className={styles.emptyState}>
          {projects.length === 0 ? '暂无项目' : '没有符合筛选条件的项目'}
        </div>
      ) : (
        <div className={styles.gantt}>
          {/* 左：项目 / 负责人 */}
          <div className={styles.ganttLeft}>
            <div
              className={`${styles.ganttRow} ${styles.ganttRowHeader}`}
              data-testid="gantt-header"
            >
              <span>项目</span>
              <span>负责人</span>
            </div>
            {filtered.map((p) => (
              <div
                key={p.id}
                className={styles.ganttRow}
                data-testid={`gantt-row-${p.id}`}
                onClick={() => setSelectedProject(p.id)}
                style={{ cursor: 'pointer' }}
              >
                <strong>{p.name}</strong>
                <span>{formatHolder(p.holderRoleId, p.holderUserId)}</span>
              </div>
            ))}
          </div>

          {/* 右：时间轴 */}
          <div className={styles.ganttRight}>
            <div className={`${styles.timelineRow} ${styles.timelineRowHeader}`}>
              {labels.map((l, i) => (
                <span key={`${l}-${i}`}>{l}</span>
              ))}
            </div>
            {filtered.map((p) => {
              const { left, width } = barGeometry(p, today);
              const isLate = daysUntil(new Date(p.deadline), today) < 0;
              const cls = barClassFor(p.status, isLate);
              return (
                <div key={p.id} className={styles.timelineRow}>
                  <span
                    className={`${styles.bar} ${cls}`}
                    data-testid={`gantt-bar-${p.id}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    onClick={() => setSelectedProject(p.id)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
