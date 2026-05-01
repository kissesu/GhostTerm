/**
 * @file ProjectListView.tsx
 * @description 进度模块项目列表视图（设计稿 1:1 复刻 §02 列表视图）。
 *
 *              业务背景：
 *              - 表头 7 列：项目 / 阶段 / 负责人 / 客户 / 到期 / 金额 / 风险
 *              - 行 grid 比例：1.35fr 0.8fr 0.7fr 0.8fr 0.65fr 0.7fr 0.65fr
 *              - 阶段使用 .status-chip（深底浅文，无方位色）
 *              - 风险列文字按 deadline + status 推导：紧急 / 反馈中 / 验收阻塞 / 已结清等
 *
 *              排序：默认 deadline ASC（最紧急在前）
 *              过滤：复用 progressUiStore.searchQuery / statusFilter
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

/** 9 状态中文短标签（设计稿 status-chip 文字） */
const STATUS_LABEL: Record<ProjectStatus, string> = {
  dealing: '洽谈中',
  quoting: '报价中',
  developing: '开发中',
  confirming: '待验收',
  delivered: '已交付',
  paid: '已收款',
  archived: '已归档',
  after_sales: '售后中',
  cancelled: '已取消',
};

/**
 * 风险列文字：基于 status + deadline 推导。
 *
 * 业务规则（设计稿例）：
 *  - paid → "已结清"
 *  - delivered → "待结算"
 *  - confirming + 已超期 → "验收阻塞"
 *  - urgent priority → "紧急"
 *  - 已超期但非 paid → "超期"
 *  - developing → "反馈中"（默认占位；TODO: 接入 feedbacks unread 计数后细化）
 *  - 其他 → "—"
 */
function riskTextFor(p: Project): string {
  if (p.status === 'paid') return '已结清';
  if (p.status === 'delivered') return '待结算';
  const days = (() => {
    try {
      return daysUntil(new Date(p.deadline));
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  })();
  if (p.status === 'confirming' && days < 0) return '验收阻塞';
  if (p.priority === 'urgent') return '紧急';
  if (days < 0) return '超期';
  if (p.status === 'developing') return '反馈中';
  return '—';
}

/**
 * 到期文字：
 *  - days < 0 → "超期 Nd"
 *  - days === 0 → "今日"
 *  - delivered/paid → "完成"
 *  - 其他 → "Nd"
 */
function deadlineTextFor(p: Project): string {
  if (p.status === 'paid' || p.status === 'delivered') return '完成';
  try {
    const days = daysUntil(new Date(p.deadline));
    if (days < 0) return `超期 ${-days}d`;
    if (days === 0) return '今日';
    return `${days}d`;
  } catch {
    return '—';
  }
}

/** holder → 简短字符串 */
function formatHolder(
  roleId: number | null | undefined,
  userId: number | null | undefined,
): string {
  if (userId != null) return `@u${userId}`;
  if (roleId != null) return `[role${roleId}]`;
  return '—';
}

/** Money string → "¥1,234" 千分位格式 */
function formatMoney(money: string): string {
  const n = Number.parseFloat(money);
  if (!Number.isFinite(n)) return money;
  return `¥${n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;
}

export function ProjectListView(): ReactElement {
  const projectsMap = useProjectsStore((s) => s.projects);
  const projectsLoading = useProjectsStore((s) => s.loading);
  const loadProjects = useProjectsStore((s) => s.load);
  const projects = useMemo(() => Array.from(projectsMap.values()), [projectsMap]);

  const searchQuery = useProgressUiStore((s) => s.searchQuery);
  const statusFilter = useProgressUiStore((s) => s.statusFilter);
  const openProjectFromView = useProgressUiStore((s) => s.openProjectFromView);

  useEffect(() => {
    void loadProjects().catch(() => {});
  }, [loadProjects]);

  const filteredProjects = useMemo(() => {
    const lowered = searchQuery.trim().toLowerCase();
    const filtered = projects.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (lowered === '') return true;
      return (
        p.name.toLowerCase().includes(lowered) ||
        p.customerLabel.toLowerCase().includes(lowered)
      );
    });
    filtered.sort((a, b) => {
      const ta = new Date(a.deadline).getTime();
      const tb = new Date(b.deadline).getTime();
      return ta - tb;
    });
    return filtered;
  }, [projects, statusFilter, searchQuery]);

  if (projectsLoading && projects.length === 0) {
    return (
      <section className={styles.viewPanel}>
        <header className={styles.viewHead}>
          <div className={styles.viewTitle}>
            <code>02</code>列表视图
          </div>
          <div className={styles.viewMeta}>用于批量检查、排序、筛选和核对金额</div>
        </header>
        <div className={styles.emptyState} data-testid="project-list-loading">
          加载项目中…
        </div>
      </section>
    );
  }

  if (filteredProjects.length === 0) {
    return (
      <section className={styles.viewPanel}>
        <header className={styles.viewHead}>
          <div className={styles.viewTitle}>
            <code>02</code>列表视图
          </div>
          <div className={styles.viewMeta}>用于批量检查、排序、筛选和核对金额</div>
        </header>
        <div className={styles.emptyState} data-testid="project-list-empty">
          {projects.length === 0 ? '暂无项目' : '没有符合筛选条件的项目'}
        </div>
      </section>
    );
  }

  return (
    <section className={styles.viewPanel} data-testid="project-list-view">
      <header className={styles.viewHead}>
        <div className={styles.viewTitle}>
          <code>02</code>列表视图
        </div>
        <div className={styles.viewMeta}>用于批量检查、排序、筛选和核对金额</div>
      </header>

      <div className={styles.table}>
        <div className={`${styles.tableRow} ${styles.tableRowHeader}`}>
          <span>项目</span>
          <span>阶段</span>
          <span>负责人</span>
          <span>客户</span>
          <span>到期</span>
          <span>金额</span>
          <span>风险</span>
        </div>
        {filteredProjects.map((p) => (
          <ProjectRow
            key={p.id}
            project={p}
            onSelect={() => openProjectFromView(p.id, 'list')}
          />
        ))}
      </div>
    </section>
  );
}

interface ProjectRowProps {
  project: Project;
  onSelect: () => void;
}

function ProjectRow({ project, onSelect }: ProjectRowProps): ReactElement {
  return (
    <div
      className={styles.tableRow}
      data-testid={`project-row-${project.id}`}
      onClick={onSelect}
    >
      <strong>{project.name}</strong>
      <span
        className={styles.statusPill}
        data-testid={`project-row-status-${project.id}`}
        data-status={project.status}
      >
        {STATUS_LABEL[project.status]}
      </span>
      <span>{formatHolder(project.holderRoleId, project.holderUserId)}</span>
      <span>{project.customerLabel || '—'}</span>
      <span data-testid={`project-row-deadline-${project.id}`}>
        {deadlineTextFor(project)}
      </span>
      <span>{formatMoney(project.currentQuote)}</span>
      <span>{riskTextFor(project)}</span>
    </div>
  );
}
