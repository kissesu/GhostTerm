/**
 * @file ProjectDetailPage.tsx
 * @description 项目详情页（Phase 11）—— 三栏布局：左 header + 事件按钮，中 tabs，右 客户卡片。
 *
 *              业务背景（spec §10.3）：
 *              - 左：项目核心信息 + EventActionButtons
 *              - 中：tabs（反馈 / 论文版本 / 文件 / 费用变更 / 收款）
 *              - 右：客户信息卡 + 编辑入口
 *
 *              数据加载策略：
 *              - 挂载时调 projectsStore.loadOne(projectId) 拉最新详情
 *              - 客户信息从 customersStore（若已 fetchAll，直接拿；否则按需 load）
 *              - 各 tab 子组件自管数据加载（FeedbackList / ThesisVersionList 等都有 useEffect）
 *
 *              不在本组件做：
 *              - 不做时间轴（status_change_logs）：spec §10.3 提到但 Phase 11 v1 不强制
 *                可在 Phase 12 通知机制配套加上（status_change_logs 已有 API）
 *              - 不做风险高亮 banner：dashboard 是独立页面（spec §10.4）
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { useEffect, useState, type ReactElement } from 'react';
import type { ActionMeta } from '../config/nbaConfig';
import { ArrowLeft, User, Calendar, Wallet, Edit3 } from 'lucide-react';

import { useProjectsStore } from '../stores/projectsStore';
import { useProgressUiStore } from '../stores/progressUiStore';
import {
  daysUntil,
  severityFromDays,
  severityColor,
  deadlineLabel,
} from '../utils/deadlineCountdown';
import { FeedbackInput } from './FeedbackInput';
import { FeedbackList } from './FeedbackList';
import { ThesisVersionList } from './ThesisVersionList';
import { FileUploadButton } from './FileUploadButton';
import { QuoteChangeDialog } from './QuoteChangeDialog';
import PaymentDialog from './PaymentDialog';
import { NbaPanel } from './NbaPanel';
import { EventTriggerDialog } from './EventTriggerDialog';

interface ProjectDetailPageProps {
  /** 项目 id（来自 progressUiStore.selectedProjectId） */
  projectId: number;
}

type DetailTab = 'feedback' | 'thesis' | 'files' | 'quote' | 'payment';

export function ProjectDetailPage({ projectId }: ProjectDetailPageProps): ReactElement {
  const project = useProjectsStore((s) => s.projects.get(projectId));
  const loadProject = useProjectsStore((s) => s.loadOne);
  const setSelectedProject = useProgressUiStore((s) => s.setSelectedProject);
  const priorView = useProgressUiStore((s) => s.priorView);
  const setCurrentView = useProgressUiStore((s) => s.setCurrentView);

  const [activeTab, setActiveTab] = useState<DetailTab>('feedback');
  const [showQuoteDialog, setShowQuoteDialog] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // NBA 动作触发：记录当前待触发的 action，null = 无弹窗
  const [activeAction, setActiveAction] = useState<ActionMeta | null>(null);

  // 拉详情（首次挂载）
  // 用户需求修正 2026-04-30：客户从独立资源降级为字段，不再需要 fetchCustomers
  useEffect(() => {
    void loadProject(projectId).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    });
  }, [projectId, loadProject]);

  if (error !== null) {
    return (
      <div
        data-testid="project-detail-error"
        style={{ padding: 20, fontSize: 13, color: 'var(--red)' }}
      >
        加载项目失败：{error}
      </div>
    );
  }

  if (!project) {
    return (
      <div
        data-testid="project-detail-loading"
        style={{ padding: 20, fontSize: 13, color: 'var(--muted)' }}
      >
        加载项目中…
      </div>
    );
  }

  const days = daysUntil(new Date(project.deadline));
  const severity = severityFromDays(days);

  const handleBack = () => {
    // priorView 由 NotificationPanel/NotificationsCenter 在 openProjectFromView 时记录；
    // 默认回项目列表，priorView=notifications 时回通知中心
    if (priorView === 'notifications') {
      setCurrentView('notifications');
    }
    setSelectedProject(null);
  };

  return (
    <div
      data-testid="project-detail-page"
      style={{
        display: 'grid',
        gridTemplateColumns: '280px 1fr 320px',
        gap: 16,
        padding: 16,
        height: '100%',
        minHeight: 0,
        background: 'transparent',
        color: 'var(--text)',
      }}
    >
      {/* ============================================
          左栏：返回按钮 + 项目 header + 事件按钮面板
          ============================================ */}
      <aside
        data-testid="project-detail-left"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          minHeight: 0,
          overflow: 'auto',
        }}
      >
        <button
          type="button"
          onClick={handleBack}
          data-testid="project-detail-back"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid var(--line)',
            background: 'transparent',
            color: 'var(--muted)',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 700,
            alignSelf: 'flex-start',
            fontFamily: 'inherit',
          }}
        >
          <ArrowLeft size={12} aria-hidden="true" /> 返回列表
        </button>

        <header
          style={{
            padding: 14,
            borderRadius: 8,
            border: '1px solid var(--line)',
            background: 'linear-gradient(180deg, #1f1f1c, #161613)',
            boxShadow: '0 8px 18px rgba(0, 0, 0, 0.18)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div
            data-testid="project-detail-title"
            style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', letterSpacing: 0.2 }}
          >
            {project.name}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11, fontWeight: 700 }}>
            <span
              data-testid="project-detail-status"
              data-status={project.status}
              style={{
                padding: '3px 8px',
                borderRadius: 5,
                background: 'var(--panel-3)',
                color: '#ddd6c1',
                border: '1px solid var(--line)',
              }}
            >
              {project.status}
            </span>
            <span
              data-testid="project-detail-deadline"
              data-severity={severity}
              style={{
                padding: '3px 8px',
                borderRadius: 5,
                color: severityColor(severity),
                border: `1px solid ${severityColor(severity)}`,
                background: 'rgba(255,255,255,0.02)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Calendar size={10} aria-hidden="true" />
              {deadlineLabel(days)}
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <User size={11} aria-hidden="true" />
            <span>
              流转在：
              {project.holderUserId
                ? `@u${project.holderUserId}`
                : project.holderRoleId
                  ? `[role${project.holderRoleId}]`
                  : '—'}
            </span>
          </div>
          <div
            data-testid="project-detail-quote"
            style={{ fontSize: 12, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Wallet size={11} aria-hidden="true" />
            <span>
              当前报价：<strong style={{ color: 'var(--text)', fontWeight: 700 }}>¥{project.currentQuote}</strong>
              <span style={{ color: 'var(--faint)', marginLeft: 6 }}>原 ¥{project.originalQuote}</span>
            </span>
          </div>
        </header>

        <NbaPanel
          project={project}
          onTriggerAction={(action) => setActiveAction(action)}
        />

        {/* NBA 事件触发弹窗：activeAction 非 null 时弹出，成功后刷新项目详情 */}
        {activeAction !== null && (
          <EventTriggerDialog
            projectId={project.id}
            event={activeAction.eventCode}
            eventLabel={activeAction.label}
            onClose={() => setActiveAction(null)}
            onSuccess={() => {
              setActiveAction(null);
              void loadProject(project.id).catch(() => {});
            }}
          />
        )}
      </aside>

      {/* ============================================
          中栏：tabs
          ============================================ */}
      <section
        data-testid="project-detail-center"
        style={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        <nav
          role="tablist"
          aria-label="项目详情"
          data-testid="project-detail-tabs"
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--line)',
            background: 'var(--bar)',
            padding: '0 4px',
          }}
        >
          <DetailTabButton
            active={activeTab === 'feedback'}
            onClick={() => setActiveTab('feedback')}
            testid="tab-feedback"
            label="反馈"
          />
          <DetailTabButton
            active={activeTab === 'thesis'}
            onClick={() => setActiveTab('thesis')}
            testid="tab-thesis"
            label="论文版本"
          />
          <DetailTabButton
            active={activeTab === 'files'}
            onClick={() => setActiveTab('files')}
            testid="tab-files"
            label="文件"
          />
          <DetailTabButton
            active={activeTab === 'quote'}
            onClick={() => setActiveTab('quote')}
            testid="tab-quote"
            label="费用变更"
          />
          <DetailTabButton
            active={activeTab === 'payment'}
            onClick={() => setActiveTab('payment')}
            testid="tab-payment"
            label="收款"
          />
        </nav>

        <div
          data-testid="project-detail-tab-body"
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {activeTab === 'feedback' && (
            <>
              <FeedbackInput projectId={projectId} />
              <FeedbackList projectId={projectId} />
            </>
          )}
          {activeTab === 'thesis' && <ThesisVersionList projectId={projectId} />}
          {activeTab === 'files' && (
            <div data-testid="files-tab-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <FileUploadButton
                onUploaded={() => {
                  // 上传完成后由 filesStore 自动追加；本组件不做额外动作
                }}
                label="上传附件"
                projectIdForLoading={projectId}
              />
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                文件列表组件由后续 worker 阶段补全（论文版本见独立 tab）
              </div>
            </div>
          )}
          {activeTab === 'quote' && (
            <div data-testid="quote-tab-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                type="button"
                onClick={() => setShowQuoteDialog(true)}
                data-testid="quote-tab-open-dialog"
                style={primaryButtonStyle}
              >
                <Edit3 size={12} aria-hidden="true" /> 录入费用变更
              </button>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                历史费用变更展示由后续 worker 阶段补全（quoteChangesStore 已就绪）
              </div>
              {showQuoteDialog && (
                <QuoteChangeDialog
                  projectId={projectId}
                  isAfterSales={project.status === 'after_sales'}
                  onClose={() => setShowQuoteDialog(false)}
                  onSuccess={() => {
                    // current_quote 变了，重新拉详情
                    void loadProject(projectId).catch(() => {});
                  }}
                />
              )}
            </div>
          )}
          {activeTab === 'payment' && (
            <div data-testid="payment-tab-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                type="button"
                onClick={() => setShowPaymentDialog(true)}
                data-testid="payment-tab-open-dialog"
                style={primaryButtonStyle}
              >
                <Edit3 size={12} aria-hidden="true" /> 录入财务流水
              </button>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                历史 payment 列表展示由后续 worker 阶段补全（paymentsStore 已就绪）
              </div>
              {showPaymentDialog && (
                <PaymentDialog
                  projectId={projectId}
                  onClose={() => setShowPaymentDialog(false)}
                  onSuccess={() => {
                    void loadProject(projectId).catch(() => {});
                  }}
                />
              )}
            </div>
          )}
        </div>
      </section>

      {/* ============================================
          右栏：客户标签卡（用户需求修正 2026-04-30 改为只读文本）
          ============================================ */}
      <aside
        data-testid="project-detail-right"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          minHeight: 0,
          overflow: 'auto',
        }}
      >
        <CustomerLabelCard customerLabel={project.customerLabel} />
      </aside>
    </div>
  );
}

interface CustomerLabelCardProps {
  customerLabel: string;
}

/**
 * 客户标签卡片：只读显示 projects.customerLabel。
 *
 * 用户需求修正 2026-04-30：客户从独立资源降级为字段，
 * 不再有客户实体的编辑入口；如需修改客户标签可走 PATCH /api/projects/{id}。
 */
function CustomerLabelCard({ customerLabel }: CustomerLabelCardProps): ReactElement {
  return (
    <div
      data-testid="project-detail-customer-card"
      style={{
        padding: 14,
        border: '1px solid var(--line)',
        background: 'var(--panel)',
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--faint)',
          textTransform: 'uppercase',
          letterSpacing: 0.6,
        }}
      >
        客户
      </span>
      <div
        data-testid="project-detail-customer-label"
        style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', whiteSpace: 'pre-wrap' }}
      >
        {customerLabel || <span style={{ color: 'var(--faint)' }}>未填写</span>}
      </div>
    </div>
  );
}

interface DetailTabButtonProps {
  active: boolean;
  onClick: () => void;
  testid: string;
  label: string;
}

function DetailTabButton({
  active,
  onClick,
  testid,
  label,
}: DetailTabButtonProps): ReactElement {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-active={active ? 'true' : 'false'}
      data-testid={testid}
      onClick={onClick}
      style={{
        padding: '10px 16px',
        border: 'none',
        background: 'transparent',
        color: active ? 'var(--accent)' : 'var(--muted)',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: active ? 800 : 700,
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  );
}

const primaryButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 14px',
  borderRadius: 6,
  border: '1px solid transparent',
  background: 'var(--accent)',
  color: 'var(--accent-ink)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 800,
  alignSelf: 'flex-start',
  fontFamily: 'inherit',
};
