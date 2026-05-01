/**
 * @file GanttView.tsx
 * @description 甘特图视图占位 - 横向时间轴（每项目一行 + 截止日 marker）
 *              设计稿无 mockup，按 §1.4 简洁实现；不支持拖拽（plan §1.4 决策）
 *              时间条宽度按"剩余天数"简单估算；负数天数 → 红色截止
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { useEffect, useMemo, type ReactElement } from 'react';
import { useProjectsStore } from '../stores/projectsStore';
import { useProgressUiStore } from '../stores/progressUiStore';
import { StatusPill } from './StatusPill';
import { daysToDeadline, formatDeadline } from '../utils/deadlineCountdown';

export function GanttView(): ReactElement {
  const projects = useProjectsStore((s) => s.projects);
  const loadAll = useProjectsStore((s) => s.loadAll);
  const openProjectFromView = useProgressUiStore((s) => s.openProjectFromView);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const list = useMemo(() => Array.from(projects.values()), [projects]);

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 16 }}>
      {list.length === 0 && (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>暂无项目</p>
      )}
      {list.map((p) => {
        const days = daysToDeadline(p.deadline);
        // 简单可视化：100 - 剩余天数，clamp 到 [20, 100]
        const barWidth = Math.max(20, Math.min(100, 100 - days));
        return (
          <div
            key={p.id}
            data-project-id={p.id}
            onClick={() => openProjectFromView(p.id, 'gantt')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '8px 0',
              borderBottom: '1px solid var(--line)',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {/* 项目名（截断） */}
            <div
              style={{
                flex: '0 0 240px',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
              }}
            >
              {p.name}
            </div>

            {/* 状态 pill */}
            <StatusPill status={p.status} />

            {/* 时间轴条 */}
            <div
              style={{
                flex: 1,
                height: 8,
                background: 'var(--panel-2)',
                borderRadius: 4,
                position: 'relative',
              }}
            >
              <div
                style={{
                  width: `${barWidth}%`,
                  height: '100%',
                  background: 'var(--accent)',
                  borderRadius: 4,
                }}
              />
            </div>

            {/* 截止文字 */}
            <div
              style={{
                flex: '0 0 80px',
                textAlign: 'right',
                color: days < 0 ? 'var(--red)' : 'var(--muted)',
              }}
            >
              {formatDeadline(days)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
