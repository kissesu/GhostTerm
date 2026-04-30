/**
 * @file KanbanView.tsx
 * @description 进度模块看板视图（Phase 10）。
 *
 *              业务背景（spec §10.2 看板视图）：
 *              - 9 个状态列；其中 cancelled 默认折叠到右侧，archived 默认折叠
 *              - 每张卡片：项目名 / 客户 / Deadline 倒计时徽章 / 当前报价
 *              - 卡片点击 → setSelectedProject 进入详情
 *
 *              拖拽 OUT OF SCOPE：
 *              - spec §6.2 规定状态切换由"事件 + 备注"触发；不能用拖拽
 *                避免用户漏写备注 / 触发非法迁移
 *              - 任务说明也明确"Cards are click-to-detail only"
 *
 *              过滤 / 搜索复用 progressUiStore：
 *              - statusFilter !== 'all' 时只显示对应列（其他列隐藏）
 *              - searchQuery 全列 contains 过滤（项目名 / 客户名）
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

import { useProjectsStore } from '../stores/projectsStore';
import { useProgressUiStore } from '../stores/progressUiStore';
import type { Project, ProjectStatus } from '../api/projects';
import {
  daysUntil,
  severityFromDays,
  severityColor,
  deadlineLabel,
} from '../utils/deadlineCountdown';

/**
 * 看板列定义。
 *
 * 业务规则：
 *  - 主流 7 列展开（dealing/quoting/developing/confirming/delivered/paid/after_sales）
 *  - archived 默认折叠
 *  - cancelled 默认折叠在最右
 *
 * spec §10.2 提到 9 状态全部显示；本 v1 用 collapsedByDefault 区分主次列。
 */
interface ColumnDef {
  status: ProjectStatus;
  label: string;
  collapsedByDefault: boolean;
}

const KANBAN_COLUMNS: ReadonlyArray<ColumnDef> = [
  { status: 'dealing', label: '洽谈中', collapsedByDefault: false },
  { status: 'quoting', label: '报价中', collapsedByDefault: false },
  { status: 'developing', label: '开发中', collapsedByDefault: false },
  { status: 'confirming', label: '待验收', collapsedByDefault: false },
  { status: 'delivered', label: '已交付', collapsedByDefault: false },
  { status: 'paid', label: '已收款', collapsedByDefault: false },
  { status: 'after_sales', label: '售后中', collapsedByDefault: false },
  { status: 'archived', label: '已归档', collapsedByDefault: true },
  { status: 'cancelled', label: '已取消', collapsedByDefault: true },
];

export function KanbanView(): ReactElement {
  // 直接订阅 Map 引用；Array.from 必须在 useMemo 内做，
  // 否则每次渲染都返回新数组 → React 19 useSyncExternalStore 报"snapshot not stable"
  const projectsMap = useProjectsStore((s) => s.projects);
  const projectsLoading = useProjectsStore((s) => s.loading);
  const loadProjects = useProjectsStore((s) => s.load);
  const projects = useMemo(() => Array.from(projectsMap.values()), [projectsMap]);

  const searchQuery = useProgressUiStore((s) => s.searchQuery);
  const statusFilter = useProgressUiStore((s) => s.statusFilter);

  // 列折叠态：存哪些列当前折叠；默认初始化 archived/cancelled 折叠
  const [collapsed, setCollapsed] = useState<Set<ProjectStatus>>(
    () => new Set(KANBAN_COLUMNS.filter((c) => c.collapsedByDefault).map((c) => c.status)),
  );

  // 首次挂载：拉项目数据
  // 用户需求修正 2026-04-30：客户从独立资源降级为字段，不再需要 fetchCustomers
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
      // 搜索过滤（项目名 + 客户标签）
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

  const toggleColumn = (status: ProjectStatus) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  // 应用 statusFilter：!== 'all' 时只显示该列
  const visibleColumns = useMemo(() => {
    if (statusFilter === 'all') return KANBAN_COLUMNS;
    return KANBAN_COLUMNS.filter((c) => c.status === statusFilter);
  }, [statusFilter]);

  if (projectsLoading && projects.length === 0) {
    return (
      <div
        data-testid="kanban-loading"
        style={{ padding: 20, fontSize: 13, color: 'var(--c-fg-muted)' }}
      >
        加载项目中…
      </div>
    );
  }

  return (
    <div
      data-testid="kanban-view"
      style={{
        display: 'flex',
        gap: 12,
        padding: 16,
        height: '100%',
        minHeight: 0,
        overflowX: 'auto',
        alignItems: 'flex-start',
      }}
    >
      {visibleColumns.map((col) => {
        const list = projectsByStatus.get(col.status) ?? [];
        const isCollapsed = collapsed.has(col.status);
        return (
          <KanbanColumn
            key={col.status}
            status={col.status}
            label={col.label}
            count={list.length}
            collapsed={isCollapsed}
            onToggle={() => toggleColumn(col.status)}
          >
            {!isCollapsed &&
              list.map((p) => (
                <KanbanCard
                  key={p.id}
                  project={p}
                />
              ))}
          </KanbanColumn>
        );
      })}
    </div>
  );
}

interface KanbanColumnProps {
  status: ProjectStatus;
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

/**
 * 看板列容器：标题（含计数）+ 折叠按钮 + 卡片列表。
 *
 * 折叠后宽度收缩到 40px，标题文字垂直显示；展开 280px。
 */
function KanbanColumn({
  status,
  label,
  count,
  collapsed,
  onToggle,
  children,
}: KanbanColumnProps): ReactElement {
  return (
    <section
      data-testid={`kanban-column-${status}`}
      data-collapsed={collapsed ? 'true' : 'false'}
      style={{
        width: collapsed ? 40 : 280,
        flex: '0 0 auto',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--c-panel)',
        border: '1px solid var(--c-border)',
        borderRadius: 6,
        maxHeight: '100%',
        minHeight: 100,
      }}
    >
      <header
        onClick={onToggle}
        data-testid={`kanban-column-header-${status}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 10px',
          borderBottom: collapsed ? 'none' : '1px solid var(--c-border)',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 500,
          color: 'var(--c-fg)',
          userSelect: 'none',
          flexDirection: collapsed ? 'column' : 'row',
        }}
      >
        {collapsed ? (
          <ChevronRight size={12} aria-hidden="true" />
        ) : (
          <ChevronDown size={12} aria-hidden="true" />
        )}
        <span
          style={{
            writingMode: collapsed ? 'vertical-rl' : 'horizontal-tb',
            textOrientation: collapsed ? 'mixed' : undefined,
          }}
        >
          {label}
        </span>
        <span style={{ color: 'var(--c-fg-muted)' }}>· {count}</span>
      </header>

      {!collapsed && (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {children}
        </div>
      )}
    </section>
  );
}

interface KanbanCardProps {
  project: Project;
}

/**
 * 看板卡片：project 名 / 客户标签 / deadline 徽章 / 当前报价。
 * 点击调 setSelectedProject 跳详情。
 *
 * 用户需求修正 2026-04-30：客户标签直接读 project.customerLabel，不再走 store 反查。
 */
function KanbanCard({ project }: KanbanCardProps): ReactElement {
  const setSelectedProject = useProgressUiStore((s) => s.setSelectedProject);
  const days = daysUntil(new Date(project.deadline));
  const severity = severityFromDays(days);

  return (
    <article
      data-testid={`kanban-card-${project.id}`}
      onClick={() => setSelectedProject(project.id)}
      style={{
        padding: 10,
        background: 'var(--c-bg)',
        border: '1px solid var(--c-border)',
        borderRadius: 4,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-fg)' }}>{project.name}</div>
      <div style={{ fontSize: 11, color: 'var(--c-fg-muted)' }}>
        {project.customerLabel || '—'}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 11,
        }}
      >
        <span
          data-testid={`kanban-card-deadline-${project.id}`}
          data-severity={severity}
          style={{
            padding: '1px 6px',
            borderRadius: 3,
            color: severityColor(severity),
            border: `1px solid ${severityColor(severity)}`,
          }}
        >
          {deadlineLabel(days)}
        </span>
        <span style={{ color: 'var(--c-fg-muted)' }}>¥{project.currentQuote}</span>
      </div>
    </article>
  );
}
