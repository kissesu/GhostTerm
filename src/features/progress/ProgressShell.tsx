/**
 * @file ProgressShell.tsx
 * @description 进度模块顶层 - 1:1 复刻设计稿 line 522-543 + 视图切换
 *              结构：Pipeline (永远显示) → ViewBar (crumb + back) → 当前 view
 *              用 progressUiStore.{currentView, selectedProjectId} 决定渲染哪个
 *              Toast 挂顶层
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import styles from './progress.module.css';
import { useProjectsStore } from './stores/projectsStore';
import { useNotificationsStore } from './stores/notificationsStore';
import { useProgressUiStore } from './stores/progressUiStore';
import { PipelineStepper } from './components/PipelineStepper';
import { ViewBar } from './components/ViewBar';
import { Toast } from './components/Toast';
import { KanbanView } from './components/KanbanView';
import { ProjectListView } from './components/ProjectListView';
import { GanttView } from './components/GanttView';
import { NotificationsCenterView } from './components/NotificationsCenterView';
import { EarningsView } from './components/EarningsView';
import { ProjectDetailPage } from './components/ProjectDetailPage';
import { NewProjectDialog } from './components/NewProjectDialog';
import { KANBAN_STAGES } from './config/nbaConfig';

export default function ProgressShell(): ReactElement {
  // ============================================
  // 第一步：从 store 读取状态（Zustand 5 selector 稳定引用：每 selector 独立拆分）
  // ============================================
  const projects = useProjectsStore((s) => s.projects);
  const loadAll = useProjectsStore((s) => s.loadAll);
  const loadNotifications = useNotificationsStore((s) => s.load);
  const currentView = useProgressUiStore((s) => s.currentView);
  const selectedProjectId = useProgressUiStore((s) => s.selectedProjectId);
  const closeProject = useProgressUiStore((s) => s.closeProject);
  const openProjectFromView = useProgressUiStore((s) => s.openProjectFromView);
  const [showCreate, setShowCreate] = useState(false);

  // ============================================
  // 第二步：mount 时加载项目列表 + 通知数（每个依赖独立 effect 避免多余重跑）
  // ============================================
  useEffect(() => { void loadAll(); }, [loadAll]);
  useEffect(() => { void loadNotifications(); }, [loadNotifications]);

  // ============================================
  // 第三步：派生计算（useMemo 保持引用稳定）
  // ============================================
  const projectList = useMemo(() => Array.from(projects.values()), [projects]);

  // 看板列有效项目数（5 活跃 stage）
  const activeProjectCount = useMemo(
    () => projectList.filter((p) => KANBAN_STAGES.includes(p.status)).length,
    [projectList],
  );

  const selectedProject = selectedProjectId !== null ? projects.get(selectedProjectId) ?? null : null;

  // 详情页时 Pipeline 高亮当前 status
  const pipelineCurrentStatus = selectedProject?.status;

  // ============================================
  // 第四步：渲染主区 — 详情页覆盖 view bar；其余 view 按 currentView 路由
  // ============================================
  let mainContent: ReactElement;
  if (selectedProjectId !== null && selectedProject) {
    mainContent = <ProjectDetailPage projectId={selectedProjectId} />;
  } else {
    switch (currentView) {
      case 'list':
        mainContent = <ProjectListView />;
        break;
      case 'gantt':
        mainContent = <GanttView />;
        break;
      case 'notifications':
        mainContent = <NotificationsCenterView />;
        break;
      case 'earnings':
        mainContent = <EarningsView />;
        break;
      case 'kanban':
      default:
        mainContent = <KanbanView />;
    }
  }

  return (
    <div className={styles.shellRoot} style={{ padding: '24px 28px 60px', minHeight: '100%' }}>
      <PipelineStepper projects={projectList} currentStatus={pipelineCurrentStatus} />
      <ViewBar
        mode={selectedProject ? 'detail' : 'kanban'}
        activeProjectCount={activeProjectCount}
        projectTitle={selectedProject?.name}
        onBack={selectedProject ? closeProject : undefined}
        actions={!selectedProject ? (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => setShowCreate(true)}
          >
            + 新建项目
          </button>
        ) : null}
      />
      {mainContent}
      {showCreate && (
        <NewProjectDialog
          onClose={() => setShowCreate(false)}
          onSuccess={(id) => openProjectFromView(id, 'kanban')}
        />
      )}
      <Toast />
    </div>
  );
}
