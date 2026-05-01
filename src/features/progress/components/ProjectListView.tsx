/**
 * @file ProjectListView.tsx
 * @description 项目列表视图 - 表格行（name / customer·level / status-pill / quote / deadline）
 *              行点击进详情；支持 statusFilter + searchQuery 过滤
 *              设计稿无 mockup，按 §1.4 简洁布局实现；字段按实际 API schema
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { useEffect, useMemo, type ReactElement } from 'react';
import { useProjectsStore } from '../stores/projectsStore';
import { useProgressUiStore } from '../stores/progressUiStore';
import { StatusPill } from './StatusPill';
import { daysToDeadline, formatDeadline, deadlineClass } from '../utils/deadlineCountdown';

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

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead style={{ background: 'var(--panel-2)', color: 'var(--muted)' }}>
          <tr>
            <th style={{ padding: 12, textAlign: 'left' }}>项目</th>
            <th style={{ padding: 12, textAlign: 'left' }}>客户·学位</th>
            <th style={{ padding: 12, textAlign: 'left' }}>状态</th>
            <th style={{ padding: 12, textAlign: 'right' }}>报价</th>
            <th style={{ padding: 12, textAlign: 'right' }}>截止</th>
          </tr>
        </thead>
        <tbody>
          {list.length === 0 && (
            <tr>
              <td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
                暂无项目
              </td>
            </tr>
          )}
          {list.map((p) => {
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
                <td style={{ padding: 12 }}>{p.customerLabel} · {p.thesisLevel ?? '—'}</td>
                <td style={{ padding: 12 }}>
                  <StatusPill status={p.status} />
                </td>
                <td style={{ padding: 12, textAlign: 'right' }}>
                  ¥{Number(p.currentQuote ?? 0).toLocaleString()}
                </td>
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
