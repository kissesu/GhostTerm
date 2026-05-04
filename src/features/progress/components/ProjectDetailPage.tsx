/**
 * @file ProjectDetailPage.tsx
 * @description 项目详情页 - 1:1 复刻设计稿 line 767-832
 *              detailLayout grid 1fr 340px：左 main + 右 NbaPanel
 *              main：DetailMainHead + DetailTabs + 当前 tab 内容
 *              右栏：NbaPanel（含 reasonContext 派生 daysSinceLastActivity）
 *
 *              tabs 接入状态（Phase 7 完成）：
 *              - 活动时间线：DetailTimeline（feedbacksStore）
 *              - 反馈：FeedbackInput + FeedbackList
 *              - 论文版本：ThesisVersionUploadDialog（两阶段：选文件 → 备注 modal） + ThesisVersionList
 *              - 文件：附件列表 + FileUploadButton
 *              - 收款：PaymentList + PaymentDialog + 调整报价按钮 + QuoteChangeDialog
 *
 *              注意：Project 字段按实际 API schema（name/customerLabel）
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import {
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from 'react';
import styles from '../progress.module.css';
import { triggerProjectEvent } from '../api/projects';
import { useProjectsStore } from '../stores/projectsStore';
import { useFeedbacksStore } from '../stores/feedbacksStore';
import { usePaymentsStore } from '../stores/paymentsStore';
import { useFilesStore } from '../stores/filesStore';
import { useActivitiesStore } from '../stores/activitiesStore';
import { type ActionMeta } from '../config/nbaConfig';
import { DetailMainHead } from './DetailMainHead';
import { DetailTabs, type DetailTab } from './DetailTabs';
import { DetailTimeline } from './DetailTimeline';
import { NbaPanel } from './NbaPanel';
import { EventTriggerDialog } from './EventTriggerDialog';
import { FeedbackInput } from './FeedbackInput';
import { FeedbackList } from './FeedbackList';
import { FileItem } from './FileItem';
import { SourceCodeUploadDialog } from './SourceCodeUploadDialog';
import { ThesisVersionList } from './ThesisVersionList';
import { ThesisVersionUploadDialog } from './ThesisVersionUploadDialog';
import { PaymentDialog } from './PaymentDialog';
import { QuoteChangeDialog } from './QuoteChangeDialog';

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

  const paymentsRaw = usePaymentsStore((s) => s.byProject.get(projectId));
  const loadPayments = usePaymentsStore((s) => s.loadByProject);
  const payments = useMemo(() => paymentsRaw ?? [], [paymentsRaw]);

  const filesRaw = useFilesStore((s) => s.byProject.get(projectId));
  const loadFiles = useFilesStore((s) => s.loadByProject);
  const files = useMemo(() => filesRaw ?? [], [filesRaw]);

  const loadActivities = useActivitiesStore((s) => s.loadActivities);

  const [activeTab, setActiveTab] = useState<DetailTab>('timeline');
  const [activeAction, setActiveAction] = useState<ActionMeta | null>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [showQuoteChange, setShowQuoteChange] = useState(false);
  // 论文版本列表刷新计数器：上传成功后 bump，ThesisVersionList 重新拉取
  const [thesisRefreshTick, setThesisRefreshTick] = useState(0);

  // 进入详情页拉取最新项目数据
  useEffect(() => {
    void loadOne(projectId);
  }, [projectId, loadOne]);

  // 拉取反馈列表（供反馈 tab 使用）
  useEffect(() => {
    void loadFeedbacks(projectId);
  }, [projectId, loadFeedbacks]);

  // 进入详情页预加载进度时间线（与反馈列表并行；DetailTimeline 自身也会兜底拉首页）
  useEffect(() => {
    void loadActivities(projectId);
  }, [projectId, loadActivities]);

  // 进入详情页清掉前一次操作的 trigger error（避免残留错误污染当前会话）
  useEffect(() => {
    clearTriggerError(projectId);
  }, [projectId, clearTriggerError]);

  // 切换到收款 tab 时自动拉取 payments
  useEffect(() => {
    if (activeTab === 'payments') {
      void loadPayments(projectId);
    }
  }, [activeTab, projectId, loadPayments]);

  // 切换到文件 tab 时自动拉取附件列表
  useEffect(() => {
    if (activeTab === 'files') {
      void loadFiles(projectId);
    }
  }, [activeTab, projectId, loadFiles]);

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

  // 论文版本上传完成回调：ThesisVersionUploadDialog 内部已完成 uploadFile + createThesisVersion
  // 双步流程，这里只负责 bump 列表 refreshTick + invalidate 进度时间线
  const handleThesisVersionUploaded = (): void => {
    setThesisRefreshTick((n) => n + 1);
    // 后端写入 thesis_versions 表 → 触发 thesis_version 类活动；前端直接 invalidate 拉新
    void useActivitiesStore.getState().invalidate(projectId);
  };

  return (
    <>
      <div className={styles.detailLayout}>
        {/* 左侧 main 区：头部 + 调整报价按钮 + tabs + tab 内容 */}
        <div className={styles.main}>
          {/* 详情页顶部行：项目头 + 调整报价入口（plan §Task 32 决策预存）
           * flexShrink:0 防止被下方 timelineList(flex:1) 抢空间压扁 */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexShrink: 0 }}>
            <div style={{ flex: 1 }}>
              <DetailMainHead project={project} />
            </div>
            <button
              type="button"
              onClick={() => setShowQuoteChange(true)}
              className={`${styles.btn} ${styles.quoteAdjustBtn}`}
            >
              调整报价
            </button>
          </div>
          <DetailTabs active={activeTab} onChange={setActiveTab} />

          {/* 进度时间线 tab */}
          {activeTab === 'timeline' && <DetailTimeline projectId={projectId} />}

          {/* 反馈 tab */}
          {activeTab === 'feedback' && (
            <div className={styles.tabPanel}>
              <FeedbackInput projectId={projectId} />
              <FeedbackList projectId={projectId} />
            </div>
          )}

          {/* 论文版本 tab：上传按钮改用 ThesisVersionUploadDialog（两阶段 — 选文件 → 弹 modal 填备注） */}
          {activeTab === 'thesis' && (
            <div className={styles.tabPanel}>
              <ThesisVersionUploadDialog
                projectId={projectId}
                onUploaded={handleThesisVersionUploaded}
              />
              <ThesisVersionList
                projectId={projectId}
                refreshTick={thesisRefreshTick}
              />
            </div>
          )}

          {/* 文件 tab */}
          {activeTab === 'files' && (
            <div className={styles.tabPanel}>
              {/* 源码上传两阶段：选文件 → 弹 modal 填备注 → attachProjectFile(category=source_code, remark)
               *  用户反馈 2026-05-03"论文版本、源码 tab 新增备注入口" */}
              <SourceCodeUploadDialog
                projectId={projectId}
                onAttached={() => {
                  void loadFiles(projectId);
                  void useActivitiesStore.getState().invalidate(projectId);
                }}
              />
              {files.filter((f) => (f.category as string) !== 'wechat_chat').length === 0 ? (
                <p style={{ color: 'var(--muted)', fontSize: 13 }}>暂无源码</p>
              ) : (
                <div>
                  {/* 过滤 wechat_chat：那些已 inline 进 project_created 时间线/详情，文件 tab 只展示源码/样稿 */}
                  {files.filter((f) => (f.category as string) !== 'wechat_chat').map((f) => (
                    <div
                      key={f.id}
                      style={{
                        borderBottom: '1px solid var(--line)',
                        padding: '10px 0',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        fontSize: 13,
                      }}
                    >
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <span style={{ flex: 1 }}>
                          <FileItem fileId={f.fileId} filename={f.file.filename} />
                        </span>
                        <span style={{ color: 'var(--muted)', fontSize: 11 }}>
                          {f.category}
                        </span>
                        <span style={{ color: 'var(--muted)', fontSize: 11 }}>
                          {new Date(f.addedAt).toLocaleDateString('zh-CN')}
                        </span>
                      </div>
                      {f.remark && (
                        <div style={{ color: 'var(--muted)', fontSize: 12, paddingLeft: 4 }}>
                          备注：{f.remark}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 收款 tab */}
          {activeTab === 'payments' && (
            <div className={styles.tabPanel}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => setShowPayment(true)}
                style={{ padding: '6px 16px', fontSize: 13, marginBottom: 12 }}
              >
                + 新增结算
              </button>
              {/* 结算流水列表 */}
              {payments.length === 0 ? (
                <p style={{ color: 'var(--muted)', fontSize: 13 }}>暂无结算记录</p>
              ) : (
                <div>
                  {payments.map((p) => (
                    <div
                      key={p.id}
                      style={{
                        borderBottom: '1px solid var(--line)',
                        padding: '10px 0',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        fontSize: 13,
                      }}
                    >
                      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                        <span style={{ color: 'var(--accent)', fontWeight: 700 }}>
                          ¥{p.amount}
                        </span>
                        <span style={{ flex: 1 }}>{p.remark}</span>
                        <span style={{ color: 'var(--muted)', fontSize: 11 }}>
                          {new Date(p.paidAt).toLocaleDateString('zh-CN')}
                        </span>
                      </div>
                      {/* 凭证截图：用户反馈 2026-05-03"结算弹窗没有上传截图的入口"
                       *  附件渲染走 FileItem，媒体直接预览，文档点击下载 */}
                      {p.attachments && p.attachments.length > 0 && (
                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 8,
                            paddingLeft: 4,
                          }}
                        >
                          {p.attachments.map((a) => (
                            <div key={a.id} style={{ width: 160, maxWidth: '100%' }}>
                              <FileItem fileId={a.id} filename={a.filename} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 右侧 NBA 推荐面板 */}
        <NbaPanel
          project={project}
          reasonContext={reasonContext}
          onTriggerAction={(action) => setActiveAction(action)}
        />
      </div>

      {/* 事件触发弹窗 — E10（结算）特殊路径走 PaymentDialog 拿凭证附件，
       *   提交后再调 triggerProjectEvent 推进 status；其它事件走通用 EventTriggerDialog
       *   用户反馈 2026-05-03"点开的结算弹窗应该收上传结算凭证截图入口" */}
      {activeAction && activeAction.eventCode === 'E10' && (
        <PaymentDialog
          projectId={project.id}
          onClose={() => setActiveAction(null)}
          onSuccess={async () => {
            try {
              // E10 切 status 到 paid（PaymentDialog 已写 payment 行 + attachments）
              await triggerProjectEvent(project.id, {
                event: 'E10',
                remark: '结算给开发，已收凭证。',
              });
            } catch (err) {
              // 状态切换失败不阻塞前端 UI（payment 行已写，状态稍后可手动推进）
              // eslint-disable-next-line no-console
              console.error('triggerProjectEvent E10 failed', err);
            }
            setActiveAction(null);
            void loadOne(project.id).catch(() => {});
            void loadFeedbacks(project.id).catch(() => {});
            void useActivitiesStore.getState().invalidate(project.id);
          }}
        />
      )}
      {activeAction && activeAction.eventCode !== 'E10' && (
        <EventTriggerDialog
          projectId={project.id}
          fromStatus={project.status}
          event={activeAction.eventCode}
          eventLabel={activeAction.label}
          onClose={() => setActiveAction(null)}
          onSuccess={() => {
            setActiveAction(null);
            // 提交成功后刷新项目数据 + 反馈列表 + 进度时间线（status_change 类活动）
            void loadOne(project.id).catch(() => {});
            void loadFeedbacks(project.id).catch(() => {});
            void useActivitiesStore.getState().invalidate(project.id);
          }}
        />
      )}

      {/* 新增收款弹窗 */}
      {showPayment && (
        <PaymentDialog
          projectId={projectId}
          onClose={() => setShowPayment(false)}
          onSuccess={() => {
            // 收款成功后刷新项目（totalReceived 更新）+ 进度时间线（payment 类活动）
            void loadOne(projectId).catch(() => {});
            void useActivitiesStore.getState().invalidate(projectId);
          }}
        />
      )}

      {/* 调整报价弹窗 */}
      {showQuoteChange && (
        <QuoteChangeDialog
          projectId={projectId}
          onClose={() => setShowQuoteChange(false)}
          onSuccess={() => {
            // 报价调整成功后刷新项目（currentQuote 更新）+ 进度时间线（quote_change 类活动）
            void loadOne(projectId).catch(() => {});
            void useActivitiesStore.getState().invalidate(projectId);
          }}
        />
      )}
    </>
  );
}
