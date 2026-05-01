/**
 * @file ProjectDetailPage.tsx
 * @description 项目详情页 - 1:1 复刻设计稿 line 767-832
 *              detailLayout grid 1fr 340px：左 main + 右 NbaPanel
 *              main：DetailMainHead + DetailTabs + 当前 tab 内容
 *              右栏：NbaPanel（含 reasonContext 派生 daysSinceLastActivity）
 *
 *              tabs 接入状态：
 *              - 活动时间线：已接 DetailTimeline（feedbacksStore）
 *              - 反馈/论文版本/文件/收款：占位文案，Phase 7 接入
 *
 *              注意：Project 字段按实际 API schema（name/customerLabel）
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import styles from '../progress.module.css';
import { useProjectsStore } from '../stores/projectsStore';
import { useFeedbacksStore } from '../stores/feedbacksStore';
import { type ActionMeta } from '../config/nbaConfig';
import { DetailMainHead } from './DetailMainHead';
import { DetailTabs, type DetailTab } from './DetailTabs';
import { DetailTimeline } from './DetailTimeline';
import { NbaPanel } from './NbaPanel';
import { EventTriggerDialog } from './EventTriggerDialog';

interface ProjectDetailPageProps {
  projectId: number;
}

export function ProjectDetailPage({ projectId }: ProjectDetailPageProps): ReactElement {
  const project = useProjectsStore((s) => s.projects.get(projectId));
  const loadOne = useProjectsStore((s) => s.loadOne);
  const loadError = useProjectsStore((s) => s.loadError);
  const clearTriggerError = useProjectsStore((s) => s.clearTriggerError);

  const feedbacksRaw = useFeedbacksStore((s) => s.byProject.get(projectId));
  const loadFeedbacks = useFeedbacksStore((s) => s.loadByProject);
  const feedbacks = useMemo(() => feedbacksRaw ?? [], [feedbacksRaw]);

  const [activeTab, setActiveTab] = useState<DetailTab>('timeline');
  const [activeAction, setActiveAction] = useState<ActionMeta | null>(null);

  // 进入详情页拉取最新项目数据
  useEffect(() => {
    void loadOne(projectId);
  }, [projectId, loadOne]);

  // 拉取反馈列表（供时间线 + 反馈 tab 使用）
  useEffect(() => {
    void loadFeedbacks(projectId);
  }, [projectId, loadFeedbacks]);

  // 进入详情页清掉前一次操作的 trigger error（避免残留错误污染当前会话）
  useEffect(() => {
    clearTriggerError(projectId);
  }, [projectId, clearTriggerError]);

  // 派生 reasonContext：距最新活动的天数（供 NbaPanel deriveReason 使用）
  const reasonContext = useMemo(() => {
    if (feedbacks.length === 0) return { daysSinceLastActivity: null as number | null };
    const latestMs = feedbacks.reduce((max, f) => {
      const t = new Date(f.recordedAt).getTime();
      return t > max ? t : max;
    }, 0);
    const days = Math.floor((Date.now() - latestMs) / 86_400_000);
    return { daysSinceLastActivity: days };
  }, [feedbacks]);

  // 项目未加载时显示 loading 或 error（保留返回入口，见 feedback_error_branch_must_keep_navigation）
  if (!project) {
    return (
      <div style={{ padding: 24 }}>
        {loadError ? (
          <div style={{ color: 'var(--red)' }}>
            <p>加载项目失败：{loadError}</p>
            <button
              type="button"
              onClick={() => void loadOne(projectId)}
              style={{
                marginTop: 12,
                padding: '6px 16px',
                border: '1px solid var(--line)',
                borderRadius: 6,
                background: 'var(--panel)',
                color: 'var(--text)',
                cursor: 'pointer',
              }}
            >
              重试
            </button>
          </div>
        ) : (
          <div style={{ color: 'var(--muted)' }}>正在加载项目…</div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className={styles.detailLayout}>
        {/* 左侧 main 区：头部 + tabs + tab 内容 */}
        <div className={styles.main}>
          <DetailMainHead project={project} />
          <DetailTabs active={activeTab} onChange={setActiveTab} />

          {/* 活动时间线 tab */}
          {activeTab === 'timeline' && <DetailTimeline feedbacks={feedbacks} />}

          {/* 反馈 tab（Phase 7 接入 FeedbackInput + FeedbackList） */}
          {activeTab === 'feedback' && (
            <div style={{ padding: 16, color: 'var(--muted)' }}>反馈 tab（Phase 7 接入）</div>
          )}

          {/* 论文版本 tab（Phase 7 接入 FileUploadButton + ThesisVersionList） */}
          {activeTab === 'thesis' && (
            <div style={{ padding: 16, color: 'var(--muted)' }}>论文版本 tab（Phase 7 接入）</div>
          )}

          {/* 文件 tab（Phase 7 接入） */}
          {activeTab === 'files' && (
            <div style={{ padding: 16, color: 'var(--muted)' }}>文件 tab（Phase 7 接入）</div>
          )}

          {/* 收款 tab（Phase 7 接入 PaymentDialog） */}
          {activeTab === 'payments' && (
            <div style={{ padding: 16, color: 'var(--muted)' }}>收款 tab（Phase 7 接入）</div>
          )}
        </div>

        {/* 右侧 NBA 推荐面板 */}
        <NbaPanel
          project={project}
          reasonContext={reasonContext}
          onTriggerAction={(action) => setActiveAction(action)}
        />
      </div>

      {/* 事件触发弹窗 */}
      {activeAction && (
        <EventTriggerDialog
          projectId={project.id}
          fromStatus={project.status}
          event={activeAction.eventCode}
          eventLabel={activeAction.label}
          onClose={() => setActiveAction(null)}
          onSuccess={() => {
            setActiveAction(null);
            // 提交成功后刷新项目数据和反馈列表
            void loadOne(project.id).catch(() => {});
            void loadFeedbacks(project.id).catch(() => {});
          }}
        />
      )}
    </>
  );
}
