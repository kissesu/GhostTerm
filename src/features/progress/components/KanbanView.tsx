/**
 * @file KanbanView.tsx
 * @description 进度模块看板视图（设计稿 1:1 复刻）。
 *
 *              业务背景：
 *              - 设计稿主板 6 列 S1-S6（dealing/quoting/developing/confirming/delivered/paid）
 *              - 用户需求 2026-04-30：原右侧 278px sidePanel（今日重点 / 阶段占比 / 人员负载）
 *                迁出到 ProgressShell 中 summary 之下的 KanbanInsightStrip 横排区，
 *                看板列恢复为单板布局占满主区宽度，节省垂直/横向空间。
 *              - 用户需求 2026-04-30：删除原 viewHead（"01 看板视图"标题块），
 *                让看板列直接占主区，给列内独立滚动腾出更多 viewport。
 *              - 9 状态枚举中 archived/after_sales/cancelled 不在主板列出，
 *                按 statusFilter 切换时仍可单独显示对应列（v1 简化为隐藏）
 *
 *              拖拽 OUT OF SCOPE：
 *              - spec §6.2 规定状态切换由"事件 + 备注"触发；不能用拖拽
 *
 *              过滤 / 搜索复用 progressUiStore：
 *              - statusFilter !== 'all' 时只显示对应列
 *              - searchQuery 全列 contains 过滤（项目名 / 客户名）
 *
 * @author Atlas.oi
 * @date 2026-04-30
 */

import { useEffect, useMemo, type ReactElement } from 'react';

import { useProjectsStore } from '../stores/projectsStore';
import { useProgressUiStore } from '../stores/progressUiStore';
import type { Project, ProjectStatus, ThesisLevel } from '../api/projects';
import { daysUntil } from '../utils/deadlineCountdown';
import styles from '../progress.module.css';

/**
 * 看板列定义（设计稿主板 S1-S6）。
 *
 * 业务规则：
 *  - 6 列对应 6 个核心状态；顺序与设计稿一致
 *  - stageCode 是视觉简写，spec §6.1 的 status 才是数据真值
 *
 * archived / after_sales / cancelled 通过 statusFilter 单独筛选时显示，
 * 主板默认只显示 S1-S6（设计稿契约）
 */
interface ColumnDef {
  status: ProjectStatus;
  label: string;
  stageCode: string;
}

const KANBAN_COLUMNS: ReadonlyArray<ColumnDef> = [
  { status: 'dealing', stageCode: 'S1', label: '洽谈中' },
  { status: 'quoting', stageCode: 'S2', label: '报价中' },
  { status: 'developing', stageCode: 'S3', label: '开发中' },
  { status: 'confirming', stageCode: 'S4', label: '待验收' },
  { status: 'delivered', stageCode: 'S5', label: '已交付' },
  { status: 'paid', stageCode: 'S6', label: '已收款' },
];

/** 论文级别 → 中文短标签（用作 tag 文字） */
const THESIS_LEVEL_LABEL: Record<ThesisLevel, string> = {
  bachelor: '本科',
  master: '硕士',
  doctor: '博士',
};

export function KanbanView(): ReactElement {
  // 直接订阅 Map 引用；Array.from 必须在 useMemo 内做，
  // 否则每次渲染都返回新数组 → React 19 useSyncExternalStore 报"snapshot not stable"
  const projectsMap = useProjectsStore((s) => s.projects);
  const projectsLoading = useProjectsStore((s) => s.loading);
  const loadProjects = useProjectsStore((s) => s.load);
  const projects = useMemo(() => Array.from(projectsMap.values()), [projectsMap]);

  const searchQuery = useProgressUiStore((s) => s.searchQuery);
  const statusFilter = useProgressUiStore((s) => s.statusFilter);

  // 首次挂载：拉项目数据
  useEffect(() => {
    void loadProjects().catch(() => {});
  }, [loadProjects]);

  // 按状态分组 + 应用搜索过滤
  const projectsByStatus = useMemo(() => {
    const lowered = searchQuery.trim().toLowerCase();
    const groups = new Map<ProjectStatus, Project[]>();
    for (const col of KANBAN_COLUMNS) {
      groups.set(col.status, []);
    }
    for (const p of projects) {
      if (lowered !== '') {
        const hit =
          p.name.toLowerCase().includes(lowered) ||
          p.customerLabel.toLowerCase().includes(lowered);
        if (!hit) continue;
      }
      const arr = groups.get(p.status);
      if (arr) arr.push(p);
    }
    // 每列按 deadline ASC 排序
    for (const arr of groups.values()) {
      arr.sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
    }
    return groups;
  }, [projects, searchQuery]);

  // 应用 statusFilter：!== 'all' 时只显示该列（设计稿主板 6 列内 + 9 状态全集匹配）
  const visibleColumns = useMemo(() => {
    if (statusFilter === 'all') return KANBAN_COLUMNS;
    return KANBAN_COLUMNS.filter((c) => c.status === statusFilter);
  }, [statusFilter]);

  if (projectsLoading && projects.length === 0) {
    return (
      <div className={styles.viewPanel}>
        <div className={styles.emptyState} data-testid="kanban-loading">
          加载项目中…
        </div>
      </div>
    );
  }

  return (
    <section className={styles.viewPanel} data-testid="kanban-view">
      {/* 用户需求 2026-04-30：删除"01 看板视图"viewHead；
          看板列直接占主区，节省垂直空间，让列内独立滚动有更多可视高度。 */}
      <div className={styles.boardShell}>
        <div className={styles.board}>
          {visibleColumns.map((col) => {
            const list = projectsByStatus.get(col.status) ?? [];
            return (
              <KanbanColumn
                key={col.status}
                status={col.status}
                label={col.label}
                stageCode={col.stageCode}
                count={list.length}
              >
                {list.map((p) => (
                  <KanbanCard key={p.id} project={p} />
                ))}
              </KanbanColumn>
            );
          })}
        </div>
      </div>
    </section>
  );
}

interface KanbanColumnProps {
  status: ProjectStatus;
  label: string;
  stageCode: string;
  count: number;
  children: React.ReactNode;
}

/**
 * 看板列容器：标题（含 stageCode S1-S6 + label）+ 计数 + 卡片列表。
 *
 * 设计稿规范：column-header 44px，列底色 #121210，列体内 .card-list padding 10px gap 10px。
 *
 * 用户需求 2026-04-30：每列独立内滚（cardList overflow:auto + flex:1），
 * 列高对齐 viewport，避免长列表把 progress 整体撑出全局滚动条。
 */
function KanbanColumn({
  status,
  label,
  stageCode,
  count,
  children,
}: KanbanColumnProps): ReactElement {
  return (
    <section
      className={styles.column}
      data-testid={`kanban-column-${status}`}
      data-collapsed="false"
    >
      <header className={styles.columnHeader}>
        <div className={styles.columnTitle}>
          <span className={styles.stageCode}>{stageCode}</span>
          {label}
        </div>
        <span className={styles.count}>{count}</span>
      </header>
      <div className={styles.cardList}>{children}</div>
    </section>
  );
}

interface KanbanCardProps {
  project: Project;
}

/**
 * 计算 deadline 徽章 className + 文字（设计稿规范）：
 *  - 超期 → late（红） + "超期 Nd"
 *  - 紧急（≤2 天） → 默认 amber（无 modifier） + "Nd"
 *  - 安全（>7 天）→ safe（绿）+ "Nd"
 *  - 中间档（3-7 天）→ amber + "Nd"
 */
function deadlineBadge(deadline: string): { cls: string; text: string } {
  const d = new Date(deadline);
  const days = daysUntil(d);
  if (days < 0) {
    return { cls: `${styles.deadline} ${styles.deadlineLate}`, text: `超期 ${-days}d` };
  }
  if (days > 7) {
    return { cls: `${styles.deadline} ${styles.deadlineSafe}`, text: `${days}d` };
  }
  return { cls: styles.deadline, text: days === 0 ? '今日' : `${days}d` };
}

/**
 * 看板卡片（设计稿 1:1 复刻）：
 *  - h2.task-title：项目名
 *  - .meta：客户行 + 流转在行（assignee 标蓝）
 *  - .card-foot：tags（论文级别 / 紧急）+ deadline 徽章
 *  - 已交付/已收款显示 amount 徽章；附加 finance/done tag
 */
function KanbanCard({ project }: KanbanCardProps): ReactElement {
  const openProjectFromView = useProgressUiStore((s) => s.openProjectFromView);
  const badge = deadlineBadge(project.deadline);
  const holder = project.holderUserId
    ? `@u${project.holderUserId}`
    : project.holderRoleId
      ? `[role${project.holderRoleId}]`
      : '未分配';

  // tags：论文级别 + （紧急 优先级）
  const levelTag = project.thesisLevel ? THESIS_LEVEL_LABEL[project.thesisLevel] : null;
  const isUrgent = project.priority === 'urgent';

  // 已交付/已收款显示 amount 徽章
  const isFinalized = project.status === 'delivered' || project.status === 'paid';
  const amountText = (() => {
    if (project.status === 'paid') return `¥${project.totalReceived || project.currentQuote} 已收`;
    if (project.status === 'delivered') return '已交付';
    return null;
  })();

  return (
    <article
      className={styles.taskCard}
      data-testid={`kanban-card-${project.id}`}
      onClick={() => openProjectFromView(project.id, 'kanban')}
    >
      <h2 className={styles.taskTitle}>{project.name}</h2>
      <div className={styles.meta}>
        <span>客户：{project.customerLabel || '—'}</span>
        <span>
          流转在：<span className={styles.assignee}>{holder}</span>
        </span>
      </div>
      <div className={styles.cardFoot}>
        <div className={styles.tags}>
          {levelTag && (
            <span className={styles.tag}>
              {levelTag}
              {project.subject ? ` · ${project.subject}` : ''}
            </span>
          )}
          {isUrgent && <span className={`${styles.tag} ${styles.tagUrgent}`}>紧急</span>}
          {project.status === 'delivered' && (
            <span className={`${styles.tag} ${styles.tagFinance}`}>未结算开发</span>
          )}
          {project.status === 'paid' && (
            <span className={`${styles.tag} ${styles.tagDone}`}>开发已结算</span>
          )}
        </div>
        {isFinalized ? (
          <span className={styles.amount}>{amountText}</span>
        ) : (
          <span
            className={badge.cls}
            data-testid={`kanban-card-deadline-${project.id}`}
          >
            {badge.text}
          </span>
        )}
      </div>
      {/* 已交付且有报价信息时附加显示报价 + 学科 */}
      {project.status === 'developing' && project.currentQuote !== '0.00' && (
        <div className={`${styles.meta} ${styles.metaExtra}`}>
          <span>
            报价 ¥{project.currentQuote}
            {project.subject ? ` · ${project.subject}` : ''}
          </span>
        </div>
      )}
    </article>
  );
}
