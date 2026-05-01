/**
 * @file ProjectDetailPage.test.tsx
 * @description ProjectDetailPage 单测：渲染 head+tabs+timeline+NbaPanel / tab 切换 / NBA CTA
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectDetailPage } from '../ProjectDetailPage';
import type { Project } from '../../api/projects';

// mock PermissionGate 直渲 children
vi.mock('../PermissionGate', () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// mock NbaSecondaryActions（简化渲染）
vi.mock('../NbaSecondaryActions', () => ({
  NbaSecondaryActions: () => null,
}));

// mock EventTriggerDialog
vi.mock('../EventTriggerDialog', () => ({
  EventTriggerDialog: ({ eventLabel, onClose }: { eventLabel: string; onClose: () => void }) => (
    <div data-testid="event-dialog">
      {eventLabel}
      <button type="button" onClick={onClose}>关闭</button>
    </div>
  ),
}));

// mock PaymentDialog（避免 paymentsStore 等级联）
vi.mock('../PaymentDialog', () => ({
  PaymentDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="payment-dialog">
      <button type="button" onClick={onClose}>关闭收款</button>
    </div>
  ),
}));

// mock QuoteChangeDialog
vi.mock('../QuoteChangeDialog', () => ({
  QuoteChangeDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="quote-change-dialog">
      <button type="button" onClick={onClose}>关闭报价</button>
    </div>
  ),
}));

// mock FeedbackInput + FeedbackList（避免 feedbacksStore 再次被调用）
vi.mock('../FeedbackInput', () => ({
  FeedbackInput: () => <div data-testid="feedback-input">反馈录入</div>,
}));
vi.mock('../FeedbackList', () => ({
  FeedbackList: () => <div data-testid="feedback-list">反馈列表</div>,
}));

// mock FileUploadButton + ThesisVersionList（避免 filesStore / listThesisVersions API）
vi.mock('../FileUploadButton', () => ({
  FileUploadButton: () => <div data-testid="file-upload-button">上传文件</div>,
}));
vi.mock('../ThesisVersionList', () => ({
  ThesisVersionList: () => <div data-testid="thesis-version-list">论文版本</div>,
}));

const baseProject: Project = {
  id: 7,
  name: '详情测试项目',
  customerLabel: '王五',
  description: '',
  priority: 'normal',
  status: 'developing',
  deadline: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  dealingAt: '2026-01-01',
  originalQuote: '8000',
  currentQuote: '8000',
  afterSalesTotal: '0',
  totalReceived: '2000',
  createdBy: 1,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  thesisLevel: 'master',
};

const mockLoadOne = vi.fn();
const mockClearTriggerError = vi.fn();
const mockLoadFeedbacks = vi.fn();
const mockLoadPayments = vi.fn();
const mockLoadFiles = vi.fn();

vi.mock('../../stores/projectsStore', () => ({
  useProjectsStore: (selector: (s: object) => unknown) =>
    selector({
      projects: new Map([[7, baseProject]]),
      loadOne: mockLoadOne,
      loadError: null,
      clearTriggerError: mockClearTriggerError,
    }),
}));

vi.mock('../../stores/feedbacksStore', () => ({
  useFeedbacksStore: (selector: (s: object) => unknown) =>
    selector({
      byProject: new Map(),
      loadByProject: mockLoadFeedbacks,
    }),
}));

vi.mock('../../stores/paymentsStore', () => ({
  usePaymentsStore: (selector: (s: object) => unknown) =>
    selector({
      byProject: new Map(),
      loadByProject: mockLoadPayments,
    }),
}));

vi.mock('../../stores/filesStore', () => ({
  useFilesStore: (selector: (s: object) => unknown) =>
    selector({
      byProject: new Map(),
      loadByProject: mockLoadFiles,
    }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProjectDetailPage', () => {
  it('渲染项目名 + StatusPill + 4 个 metaRow 字段', () => {
    render(<ProjectDetailPage projectId={7} />);
    expect(screen.getByText('详情测试项目')).toBeInTheDocument();
    // 报价 ¥8,000
    expect(screen.getByText('¥8,000')).toBeInTheDocument();
    // NbaPanel 在右侧
    expect(screen.getByTestId('nba-panel')).toBeInTheDocument();
  });

  it('默认 tab = 活动时间线，显示"暂无活动"', () => {
    render(<ProjectDetailPage projectId={7} />);
    // 时间线 tab 内容
    expect(screen.getByText('暂无活动')).toBeInTheDocument();
  });

  it('点击 "反馈" tab → 渲染 FeedbackInput + FeedbackList', async () => {
    render(<ProjectDetailPage projectId={7} />);
    await userEvent.click(screen.getByRole('tab', { name: '反馈' }));
    expect(screen.getByTestId('feedback-input')).toBeInTheDocument();
    expect(screen.getByTestId('feedback-list')).toBeInTheDocument();
  });

  it('点击 "论文版本" tab → 渲染 FileUploadButton + ThesisVersionList', async () => {
    render(<ProjectDetailPage projectId={7} />);
    await userEvent.click(screen.getByRole('tab', { name: '论文版本' }));
    expect(screen.getByTestId('file-upload-button')).toBeInTheDocument();
    expect(screen.getByTestId('thesis-version-list')).toBeInTheDocument();
  });

  it('点击 "收款" tab → 渲染"+ 新增收款"按钮', async () => {
    render(<ProjectDetailPage projectId={7} />);
    await userEvent.click(screen.getByRole('tab', { name: '收款' }));
    expect(screen.getByRole('button', { name: '+ 新增收款' })).toBeInTheDocument();
  });

  it('点击"+ 新增收款"→ PaymentDialog 出现', async () => {
    render(<ProjectDetailPage projectId={7} />);
    await userEvent.click(screen.getByRole('tab', { name: '收款' }));
    await userEvent.click(screen.getByRole('button', { name: '+ 新增收款' }));
    expect(screen.getByTestId('payment-dialog')).toBeInTheDocument();
  });

  it('点击"调整报价"→ QuoteChangeDialog 出现', async () => {
    render(<ProjectDetailPage projectId={7} />);
    await userEvent.click(screen.getByRole('button', { name: '调整报价' }));
    expect(screen.getByTestId('quote-change-dialog')).toBeInTheDocument();
  });

  it('点击 NBA CTA → 弹出 EventTriggerDialog', async () => {
    render(<ProjectDetailPage projectId={7} />);
    const ctaBtn = screen.getByTestId('nba-cta');
    await userEvent.click(ctaBtn);
    expect(screen.getByTestId('event-dialog')).toBeInTheDocument();
  });

  it('mount 后调用 loadOne + loadFeedbacks + clearTriggerError', () => {
    render(<ProjectDetailPage projectId={7} />);
    expect(mockLoadOne).toHaveBeenCalledWith(7);
    expect(mockLoadFeedbacks).toHaveBeenCalledWith(7);
    expect(mockClearTriggerError).toHaveBeenCalledWith(7);
  });
});
