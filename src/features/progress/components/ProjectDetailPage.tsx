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
import { EventActionButtons } from './EventActionButtons';

interface ProjectDetailPageProps {
  /** 项目 id（来自 progressUiStore.selectedProjectId） */
  projectId: number;
}

type DetailTab = 'feedback' | 'thesis' | 'files' | 'quote' | 'payment';

export function ProjectDetailPage({ projectId }: ProjectDetailPageProps): ReactElement {
  const project = useProjectsStore((s) => s.projects.get(projectId));
  const loadProject = useProjectsStore((s) => s.loadOne);
  const setSelectedProject = useProgressUiStore((s) => s.setSelectedProject);

  const [activeTab, setActiveTab] = useState<DetailTab>('feedback');
  const [showQuoteDialog, setShowQuoteDialog] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        style={{ padding: 20, fontSize: 13, color: 'var(--c-red, #d8453b)' }}
      >
        加载项目失败：{error}
      </div>
    );
  }

  if (!project) {
    return (
      <div
        data-testid="project-detail-loading"
        style={{ padding: 20, fontSize: 13, color: 'var(--c-fg-muted)' }}
      >
        加载项目中…
      </div>
    );
  }

  const days = daysUntil(new Date(project.deadline));
  const severity = severityFromDays(days);

  const handleBack = () => {
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
        background: 'var(--c-bg)',
        color: 'var(--c-fg)',
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
            gap: 4,
            padding: '4px 8px',
            borderRadius: 4,
            border: '1px solid var(--c-border)',
            background: 'transparent',
            color: 'var(--c-fg)',
            cursor: 'pointer',
            fontSize: 12,
            alignSelf: 'flex-start',
          }}
        >
          <ArrowLeft size={12} aria-hidden="true" /> 返回列表
        </button>

        <header
          style={{
            padding: 12,
            borderRadius: 6,
            background: 'var(--c-panel)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div
            data-testid="project-detail-title"
            style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-fg)' }}
          >
            {project.name}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11 }}>
            <span
              data-testid="project-detail-status"
              data-status={project.status}
              style={{
                padding: '2px 8px',
                borderRadius: 3,
                background: 'var(--c-bg)',
                color: 'var(--c-fg)',
                border: '1px solid var(--c-border)',
              }}
            >
              {project.status}
            </span>
            <span
              data-testid="project-detail-deadline"
              data-severity={severity}
              style={{
                padding: '2px 8px',
                borderRadius: 3,
                color: severityColor(severity),
                border: `1px solid ${severityColor(severity)}`,
              }}
            >
              <Calendar size={10} aria-hidden="true" style={{ marginRight: 4 }} />
              {deadlineLabel(days)}
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--c-fg-muted)' }}>
            <User size={11} aria-hidden="true" style={{ marginRight: 4 }} />
            流转在：
            {project.holderUserId
              ? `@u${project.holderUserId}`
              : project.holderRoleId
                ? `[role${project.holderRoleId}]`
                : '—'}
          </div>
          <div
            data-testid="project-detail-quote"
            style={{ fontSize: 12, color: 'var(--c-fg-muted)' }}
          >
            <Wallet size={11} aria-hidden="true" style={{ marginRight: 4 }} />
            当前报价：¥{project.currentQuote}（原 ¥{project.originalQuote}）
          </div>
        </header>

        <EventActionButtons
          projectId={projectId}
          status={project.status}
          onEventTriggered={() => {
            // 触发事件成功后 store 已更新 project；不需要额外刷新
          }}
        />
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
          background: 'var(--c-panel)',
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        <nav
          role="tablist"
          aria-label="项目详情"
          data-testid="project-detail-tabs"
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--c-border)',
            background: 'var(--c-bg)',
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
            padding: 12,
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
            <div data-testid="files-tab-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <FileUploadButton
                onUploaded={() => {
                  // 上传完成后由 filesStore 自动追加；本组件不做额外动作
                }}
                label="上传附件"
                projectIdForLoading={projectId}
              />
              <div style={{ fontSize: 12, color: 'var(--c-fg-muted)' }}>
                文件列表组件由后续 worker 阶段补全（论文版本见独立 tab）
              </div>
            </div>
          )}
          {activeTab === 'quote' && (
            <div data-testid="quote-tab-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                type="button"
                onClick={() => setShowQuoteDialog(true)}
                data-testid="quote-tab-open-dialog"
                style={primaryButtonStyle}
              >
                <Edit3 size={12} aria-hidden="true" /> 录入费用变更
              </button>
              <div style={{ fontSize: 12, color: 'var(--c-fg-muted)' }}>
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
            <div data-testid="payment-tab-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                type="button"
                onClick={() => setShowPaymentDialog(true)}
                data-testid="payment-tab-open-dialog"
                style={primaryButtonStyle}
              >
                <Edit3 size={12} aria-hidden="true" /> 录入财务流水
              </button>
              <div style={{ fontSize: 12, color: 'var(--c-fg-muted)' }}>
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
        padding: 12,
        background: 'var(--c-panel)',
        borderRadius: 6,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: 'var(--c-fg-muted)',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        客户
      </span>
      <div
        data-testid="project-detail-customer-label"
        style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-fg)', whiteSpace: 'pre-wrap' }}
      >
        {customerLabel || <span style={{ color: 'var(--c-fg-muted)' }}>未填写</span>}
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
        padding: '8px 14px',
        border: 'none',
        background: 'transparent',
        color: active ? 'var(--c-fg)' : 'var(--c-fg-muted)',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: active ? 500 : 400,
        borderBottom: active
          ? '2px solid var(--c-accent)'
          : '2px solid transparent',
      }}
    >
      {label}
    </button>
  );
}

const primaryButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '6px 12px',
  borderRadius: 4,
  border: 'none',
  background: 'var(--c-accent)',
  color: 'var(--c-on-accent, var(--c-bg))',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 500,
  alignSelf: 'flex-start',
};
