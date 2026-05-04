/**
 * @file ProjectListView.tsx
 * @description 项目列表视图 - 表格行（name / customer·level / status-pill / quote / deadline）
 *              行点击进详情；支持 statusFilter + searchQuery 过滤
 *              设计稿无 mockup，按 §1.4 简洁布局实现；字段按实际 API schema
 *
 *              用户反馈 2026-05-03"归档的 table 应该显示更多详细的字段, 例如创建项目的时间、
 *              报价、已结算金额、结算时间、归档时间等"——statusFilter='archived' 时切换列
 *              （加创建时间/已结算/结算时间/归档时间），其它过滤保持原 5 列简洁
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { useEffect, useMemo, type ReactElement } from 'react';
import { useProjectsStore } from '../stores/projectsStore';
import { THESIS_LEVEL_LABEL } from '../api/projects';
import { useProgressUiStore } from '../stores/progressUiStore';
import { StatusPill } from './StatusPill';
import { daysToDeadline, formatDeadline, deadlineClass } from '../utils/deadlineCountdown';

/** 短日期格式 YYYY-MM-DD（归档表格列宽较紧，不显示时分秒） */
function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const dd = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** 金额格式 ¥X,XXX；null/0 仍显示 ¥0（与 mainHead 一致） */
function formatYen(money: string | null | undefined): string {
  return '¥' + Number(money ?? 0).toLocaleString();
}

export function ProjectListView(): ReactElement {
  const projects = useProjectsStore((s) => s.projects);
  const loadAll = useProjectsStore((s) => s.loadAll);
  const filter = useProgressUiStore((s) => s.statusFilter);
  const search = useProgressUiStore((s) => s.searchQuery);
  const openProjectFromView = useProgressUiStore((s) => s.openProjectFromView);

  // 进入列表视图时拉取所有项目
  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // 按状态过滤 + 搜索词过滤（name / customerLabel）
  const list = useMemo(() => {
    return Array.from(projects.values()).filter((p) => {
      if (filter !== 'all' && p.status !== filter) return false;
      if (
        search &&
        !p.name.toLowerCase().includes(search.toLowerCase()) &&
        !p.customerLabel.toLowerCase().includes(search.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [projects, filter, search]);

  // 归档筛选下走详细列布局，其它走原简洁 5 列
  const isArchivedView = filter === 'archived';

  // 归档视图列样式：白底不换行 + 内容自适应宽度
  const archivedTh: React.CSSProperties = {
    padding: '12px 16px',
    textAlign: 'left',
    whiteSpace: 'nowrap',
  };
  const archivedThRight: React.CSSProperties = { ...archivedTh, textAlign: 'right' };
  const archivedTd: React.CSSProperties = {
    padding: '12px 16px',
    whiteSpace: 'nowrap',
  };
  const archivedTdRight: React.CSSProperties = { ...archivedTd, textAlign: 'right' };

  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 10,
        // 归档视图列多时容器内横向滚动；其它视图保持原样不溢出
        overflow: isArchivedView ? 'auto' : 'hidden',
      }}
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 13,
          // 归档视图改 auto 让列宽跟随内容；其它视图保持默认 auto 也兼容
          tableLayout: 'auto',
        }}
      >
        <thead style={{ background: 'var(--panel-2)', color: 'var(--muted)' }}>
          {isArchivedView ? (
            <tr>
              <th style={archivedTh}>项目</th>
              <th style={archivedTh}>客户·学位</th>
              <th style={archivedTh}>学科</th>
              <th style={archivedTh}>创建时间</th>
              <th style={archivedTh}>截止时间</th>
              <th style={archivedThRight}>报价</th>
              <th style={archivedThRight}>已结算</th>
              <th style={archivedThRight}>售后追加</th>
              <th style={archivedTh}>交付时间</th>
              <th style={archivedTh}>结算时间</th>
              <th style={archivedTh}>归档时间</th>
            </tr>
          ) : (
            <tr>
              <th style={{ padding: 12, textAlign: 'left' }}>项目</th>
              <th style={{ padding: 12, textAlign: 'left' }}>客户·学位</th>
              <th style={{ padding: 12, textAlign: 'left' }}>状态</th>
              <th style={{ padding: 12, textAlign: 'right' }}>报价</th>
              <th style={{ padding: 12, textAlign: 'right' }}>截止</th>
            </tr>
          )}
        </thead>
        <tbody>
          {list.length === 0 && (
            <tr>
              <td
                colSpan={isArchivedView ? 11 : 5}
                style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}
              >
                暂无项目
              </td>
            </tr>
          )}
          {list.map((p) => {
            if (isArchivedView) {
              return (
                <tr
                  key={p.id}
                  onClick={() => openProjectFromView(p.id, 'list')}
                  style={{ borderTop: '1px solid var(--line)', cursor: 'pointer' }}
                  data-project-id={p.id}
                >
                  <td style={archivedTd}>{p.name}</td>
                  <td style={archivedTd}>
                    {p.customerLabel} · {p.thesisLevel ? THESIS_LEVEL_LABEL[p.thesisLevel] : '—'}
                  </td>
                  <td style={archivedTd}>{p.subject ?? '—'}</td>
                  <td style={archivedTd}>{formatShortDate(p.createdAt)}</td>
                  <td style={archivedTd}>{formatShortDate(p.deadline)}</td>
                  <td style={archivedTdRight}>{formatYen(p.currentQuote)}</td>
                  <td style={{ ...archivedTdRight, color: 'var(--accent)' }}>
                    {formatYen(p.totalReceived)}
                  </td>
                  <td
                    style={{
                      ...archivedTdRight,
                      color: Number(p.afterSalesTotal ?? 0) > 0 ? 'var(--amber)' : 'var(--muted)',
                    }}
                  >
                    {formatYen(p.afterSalesTotal)}
                  </td>
                  <td style={archivedTd}>{formatShortDate(p.deliveredAt)}</td>
                  <td style={archivedTd}>{formatShortDate(p.paidAt)}</td>
                  <td style={archivedTd}>{formatShortDate(p.archivedAt)}</td>
                </tr>
              );
            }
            const days = daysToDeadline(p.deadline);
            const ddCls = deadlineClass(days);
            return (
              <tr
                key={p.id}
                onClick={() => openProjectFromView(p.id, 'list')}
                style={{ borderTop: '1px solid var(--line)', cursor: 'pointer' }}
                data-project-id={p.id}
              >
                <td style={{ padding: 12 }}>{p.name}</td>
                <td style={{ padding: 12 }}>{p.customerLabel} · {p.thesisLevel ? THESIS_LEVEL_LABEL[p.thesisLevel] : '—'}</td>
                <td style={{ padding: 12 }}>
                  <StatusPill status={p.status} />
                </td>
                <td style={{ padding: 12, textAlign: 'right' }}>{formatYen(p.currentQuote)}</td>
                <td
                  style={{
                    padding: 12,
                    textAlign: 'right',
                    color:
                      ddCls === 'deadlineHot'
                        ? 'var(--red)'
                        : ddCls === 'deadlineWarm'
                          ? 'var(--amber)'
                          : 'inherit',
                  }}
                >
                  {formatDeadline(days)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
