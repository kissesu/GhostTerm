/**
 * @file KanbanView.tsx
 * @description 看板视图 - 1:1 复刻设计稿 line 139-169 + 701-753
 *              固定 5 列 (dealing/quoting/developing/confirming/delivered)
 *              col-head: name + count
 *              卡片用 KanbanCard 组件；点卡进详情；点 cardCta 弹 EventTriggerDialog
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import styles from '../progress.module.css';
import type { Project } from '../api/projects';
import { useProjectsStore } from '../stores/projectsStore';
import { useProgressUiStore } from '../stores/progressUiStore';
import { KANBAN_STAGES, STATUS_LABEL, type ActionMeta } from '../config/nbaConfig';
import { KanbanCard } from './KanbanCard';
import { EventTriggerDialog } from './EventTriggerDialog';

export function KanbanView(): ReactElement {
  const projects = useProjectsStore((s) => s.projects);
  const loadAll = useProjectsStore((s) => s.loadAll);
  const openProjectFromView = useProgressUiStore((s) => s.openProjectFromView);

  // 进入看板视图时拉取所有项目
  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // 当前激活的 CTA 操作（保存 project + action，供 EventTriggerDialog 消费）
  const [activeAction, setActiveAction] = useState<{ project: Project; action: ActionMeta } | null>(null);

  // 按 5 个 kanban stage 分组，Map 的顺序保持与 KANBAN_STAGES 一致
  const groupedByStage = useMemo(() => {
    const map = new Map<string, Project[]>();
    // 先初始化空数组，保证 5 列都存在（即使无项目）
    KANBAN_STAGES.forEach((s) => map.set(s, []));
    Array.from(projects.values()).forEach((p) => {
      if (KANBAN_STAGES.includes(p.status)) {
        map.get(p.status)!.push(p);
      }
    });
    return map;
  }, [projects]);

  return (
    <>
      <div className={styles.kanban}>
        {KANBAN_STAGES.map((stage) => {
          const items = groupedByStage.get(stage) ?? [];
          return (
            <div key={stage} className={styles.col} data-stage={stage}>
              <div className={styles.colHead}>
                <div className={styles.colName}>{STATUS_LABEL[stage]}</div>
                <div className={styles.colCount}>{items.length}</div>
              </div>
              <div className={styles.colBody}>
                {items.map((p) => (
                  <KanbanCard
                    key={p.id}
                    project={p}
                    onOpenDetail={(id) => openProjectFromView(id, 'kanban')}
                    onTriggerCta={(project, action) => setActiveAction({ project, action })}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* 事件触发弹窗：activeAction 有值时挂载 */}
      {activeAction && (
        <EventTriggerDialog
          projectId={activeAction.project.id}
          fromStatus={activeAction.project.status}
          event={activeAction.action.eventCode}
          eventLabel={activeAction.action.label}
          onClose={() => setActiveAction(null)}
          onSuccess={() => setActiveAction(null)}
        />
      )}
    </>
  );
}
