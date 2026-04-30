/**
 * @file ProjectListView.tsx
 * @description 进度模块项目列表视图（Phase 10）。
 *
 *              业务背景（spec §10.2 列表视图）：
 *              - 表格展示：状态点 / 项目名 / 客户 / 状态 / 流转在 / 报价 / Deadline / 反馈
 *              - 默认按 deadline_at ASC 排序（最紧急的在前）
 *              - 行点击进入详情页（setSelectedProject）
 *
 *              数据来源：
 *              - useProjectsStore.selectAll() 拿全部已加载项目
 *              - useCustomersStore 拿 customers，按 customerId 二次拼接
 *              - searchQuery 走前端 contains 过滤（项目名 / 客户名）
 *              - statusFilter 走前端精确过滤
 *
 *              首次挂载：
 *              - 调 projectsStore.load() 拉取项目列表
 *              - 调 customersStore.fetchAll() 拉取客户列表用于行展示
 *
 *              语义边界：
 *              - 不做服务端搜索：v1 项目数 < 200，前端 filter 足够
 *              - 不做 holder 名字解析：v1 仅显示 holderRoleId / holderUserId 数字
 *                （后续 Phase 12 引入 user 列表时改为名字）
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { useEffect, useMemo, type ReactElement } from 'react';

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
 * 9 个状态的中文标签 + 徽章颜色（spec §10.6 + 任务说明）。
 *
 * 颜色取值参考任务说明：dealing=gray, quoting=blue, dev_started=indigo,
 *   confirming=amber, delivered=green, paid=emerald, archived=slate,
 *   cancelled=red, after_sales=violet
 *
 * 实现：直接给 OKLCH/HSL color，避免引入新 CSS 变量；项目主题切换时这些徽章
 * 会保持一致颜色（语义颜色 ≠ 主题色，spec §10.6 也未约束徽章必须主题化）
 */
interface StatusMeta {
  label: string;
  color: string;
  bg: string;
}

const STATUS_META: Record<ProjectStatus, StatusMeta> = {
  dealing: { label: '洽谈中', color: 'oklch(80% 0 0)', bg: 'oklch(30% 0 0)' },
  quoting: { label: '报价中', color: 'oklch(80% 0.13 240)', bg: 'oklch(28% 0.08 240)' },
  // spec 用 'developing'；任务说明的 dev_started 是别名 → 同一档（indigo）
  developing: { label: '开发中', color: 'oklch(78% 0.13 270)', bg: 'oklch(28% 0.08 270)' },
  confirming: { label: '待验收', color: 'oklch(82% 0.16 80)', bg: 'oklch(28% 0.08 80)' },
  delivered: { label: '已交付', color: 'oklch(80% 0.16 145)', bg: 'oklch(28% 0.08 145)' },
  paid: { label: '已收款', color: 'oklch(80% 0.16 165)', bg: 'oklch(28% 0.08 165)' },
  archived: { label: '已归档', color: 'oklch(72% 0.01 230)', bg: 'oklch(26% 0.01 230)' },
  after_sales: { label: '售后中', color: 'oklch(78% 0.18 305)', bg: 'oklch(28% 0.08 305)' },
  cancelled: { label: '已取消', color: 'oklch(72% 0.20 25)', bg: 'oklch(28% 0.08 25)' },
};

export function ProjectListView(): ReactElement {
  // 直接订阅 Map 引用；Array.from 必须在 useMemo 内做，
  // 否则每次渲染都返回新数组 → React 19 useSyncExternalStore 报"snapshot not stable"
  const projectsMap = useProjectsStore((s) => s.projects);
  const projectsLoading = useProjectsStore((s) => s.loading);
  const loadProjects = useProjectsStore((s) => s.load);
  const projects = useMemo(() => Array.from(projectsMap.values()), [projectsMap]);

  const searchQuery = useProgressUiStore((s) => s.searchQuery);
  const statusFilter = useProgressUiStore((s) => s.statusFilter);
  const setSelectedProject = useProgressUiStore((s) => s.setSelectedProject);

  // ============================================
  // 首次挂载：拉取项目列表
  // 用户需求修正 2026-04-30：客户从独立资源降级为字段，不再需要 fetchCustomers
  // ============================================
  useEffect(() => {
    void loadProjects().catch(() => {
      // 错误暴露在 store 中；列表会回退到空数据
    });
  }, [loadProjects]);

  // ============================================
  // 应用过滤 + 排序
  // 业务规则：
  //  1. statusFilter !== 'all' 精确过滤
  //  2. searchQuery contains 过滤（项目名 + 客户标签 兼顾）
  //  3. 按 deadline ASC 排序（最紧急在前）
  // ============================================
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
    // 按 deadline ASC（更早到期的项目排前面）
    filtered.sort((a, b) => {
      const ta = new Date(a.deadline).getTime();
      const tb = new Date(b.deadline).getTime();
      return ta - tb;
    });
    return filtered;
  }, [projects, statusFilter, searchQuery]);

  if (projectsLoading && projects.length === 0) {
    return (
      <div
        data-testid="project-list-loading"
        style={{ padding: 20, fontSize: 13, color: 'var(--c-fg-muted)' }}
      >
        加载项目中…
      </div>
    );
  }

  if (filteredProjects.length === 0) {
    return (
      <div
        data-testid="project-list-empty"
        style={{ padding: 20, fontSize: 13, color: 'var(--c-fg-muted)' }}
      >
        {projects.length === 0 ? '暂无项目' : '没有符合筛选条件的项目'}
      </div>
    );
  }

  return (
    <table
      data-testid="project-list-view"
      style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: 13,
      }}
    >
      <thead>
        <tr
          style={{
            textAlign: 'left',
            borderBottom: '1px solid var(--c-border)',
            background: 'var(--c-panel)',
            position: 'sticky',
            top: 0,
            zIndex: 1,
          }}
        >
          <th style={thStyle}>项目名</th>
          <th style={thStyle}>客户</th>
          <th style={thStyle}>状态</th>
          <th style={thStyle}>流转在</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>当前报价</th>
          <th style={thStyle}>Deadline</th>
          <th style={thStyle}>更新时间</th>
        </tr>
      </thead>
      <tbody>
        {filteredProjects.map((p) => (
          <ProjectRow
            key={p.id}
            project={p}
            onSelect={() => setSelectedProject(p.id)}
          />
        ))}
      </tbody>
    </table>
  );
}

interface ProjectRowProps {
  project: Project;
  onSelect: () => void;
}

/**
 * 单行渲染。拆出独立组件让 deadline 计算 + 行交互逻辑各自闭包。
 */
function ProjectRow({ project, onSelect }: ProjectRowProps): ReactElement {
  const meta = STATUS_META[project.status];
  const deadlineDate = new Date(project.deadline);
  const days = daysUntil(deadlineDate);
  const severity = severityFromDays(days);

  // 流转在：spec §10.2 显示 holder.display_name；v1 简化为 "@user{id}" 或 "[role{id}]"
  const holderText = formatHolder(project.holderRoleId, project.holderUserId);

  const updatedAtText = formatDate(project.updatedAt);

  return (
    <tr
      data-testid={`project-row-${project.id}`}
      onClick={onSelect}
      style={{
        cursor: 'pointer',
        borderBottom: '1px solid var(--c-border)',
      }}
    >
      <td style={tdStyle}>
        <span style={{ fontWeight: 500, color: 'var(--c-fg)' }}>{project.name}</span>
      </td>
      <td style={tdStyle}>
        {project.customerLabel || (
          <span style={{ color: 'var(--c-fg-muted)' }}>—</span>
        )}
      </td>
      <td style={tdStyle}>
        <span
          data-testid={`project-row-status-${project.id}`}
          data-status={project.status}
          style={{
            display: 'inline-block',
            padding: '2px 8px',
            borderRadius: 3,
            fontSize: 11,
            fontWeight: 500,
            color: meta.color,
            background: meta.bg,
          }}
        >
          {meta.label}
        </span>
      </td>
      <td style={tdStyle}>
        <span style={{ color: 'var(--c-fg-muted)' }}>{holderText}</span>
      </td>
      <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        ¥{project.currentQuote}
      </td>
      <td style={tdStyle}>
        <span
          data-testid={`project-row-deadline-${project.id}`}
          data-severity={severity}
          style={{
            display: 'inline-block',
            padding: '2px 8px',
            borderRadius: 3,
            fontSize: 11,
            fontWeight: 500,
            color: severityColor(severity),
            border: `1px solid ${severityColor(severity)}`,
          }}
        >
          {deadlineLabel(days)}
        </span>
      </td>
      <td style={{ ...tdStyle, color: 'var(--c-fg-muted)', fontSize: 12 }}>{updatedAtText}</td>
    </tr>
  );
}

/** 把 holder 角色/用户 id 渲染为人类可读简短字符串。 */
function formatHolder(
  roleId: number | null | undefined,
  userId: number | null | undefined,
): string {
  if (userId != null) return `@u${userId}`;
  if (roleId != null) return `[role${roleId}]`;
  return '—';
}

/** ISO datetime → "YYYY-MM-DD" 简短日期。 */
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  } catch {
    return iso;
  }
}

const thStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontWeight: 500,
  fontSize: 12,
  color: 'var(--c-fg-muted)',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 12px',
};
