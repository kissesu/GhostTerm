/**
 * @file ProgressShell.test.tsx
 * @description ProgressShell 单测：mount 调两 store load / view 路由 / 详情页路由 / ViewBar back
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ProgressShell from '../../ProgressShell';
import type { Project } from '../../api/projects';

// ============================================
// mock 子组件：避免各子组件的 store 传递污染
// ============================================
vi.mock('../PipelineStepper', () => ({
  PipelineStepper: () => <div data-testid="pipeline-stepper" />,
}));
vi.mock('../ViewBar', () => ({
  ViewBar: ({ mode, onBack }: { mode: string; onBack?: () => void }) => (
    <div data-testid="view-bar" data-mode={mode}>
      {mode === 'detail' && onBack && (
        <button type="button" onClick={onBack} data-testid="view-bar-back">
          返回看板
        </button>
      )}
    </div>
  ),
}));
vi.mock('../Toast', () => ({
  Toast: () => <div data-testid="toast" />,
}));
vi.mock('../KanbanView', () => ({
  KanbanView: () => <div data-testid="kanban-view" />,
}));
vi.mock('../ProjectListView', () => ({
  ProjectListView: () => <div data-testid="list-view" />,
}));
vi.mock('../GanttView', () => ({
  GanttView: () => <div data-testid="gantt-view" />,
}));
vi.mock('../NotificationsCenterView', () => ({
  NotificationsCenterView: () => <div data-testid="notifications-view" />,
}));
vi.mock('../EarningsView', () => ({
  EarningsView: () => <div data-testid="earnings-view" />,
}));
vi.mock('../ProjectDetailPage', () => ({
  ProjectDetailPage: ({ projectId }: { projectId: number }) => (
    <div data-testid="detail-page" data-project-id={projectId} />
  ),
}));

// ============================================
// mock stores：可在测试中控制 currentView / selectedProjectId
// ============================================
const mockLoadAll = vi.fn();
const mockLoadNotifications = vi.fn();
const mockCloseProject = vi.fn();

let mockCurrentView = 'kanban';
let mockSelectedProjectId: number | null = null;
const baseProject: Project = {
  id: 5,
  name: '测试项目Shell',
  customerLabel: '客户X',
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
};

vi.mock('../../stores/projectsStore', () => ({
  useProjectsStore: (selector: (s: object) => unknown) =>
    selector({
      projects: new Map([[5, baseProject]]),
      loadAll: mockLoadAll,
    }),
}));

vi.mock('../../stores/notificationsStore', () => ({
  useNotificationsStore: (selector: (s: object) => unknown) =>
    selector({ load: mockLoadNotifications }),
}));

vi.mock('../../stores/progressUiStore', () => ({
  useProgressUiStore: (selector: (s: object) => unknown) =>
    selector({
      currentView: mockCurrentView,
      selectedProjectId: mockSelectedProjectId,
      closeProject: mockCloseProject,
    }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockCurrentView = 'kanban';
  mockSelectedProjectId = null;
});

describe('ProgressShell', () => {
  it('mount 时调用 loadAll + load (notifications)', () => {
    render(<ProgressShell />);
    expect(mockLoadAll).toHaveBeenCalledOnce();
    expect(mockLoadNotifications).toHaveBeenCalledOnce();
  });

  it('默认 currentView="kanban" 渲染 KanbanView', () => {
    render(<ProgressShell />);
    expect(screen.getByTestId('kanban-view')).toBeInTheDocument();
    expect(screen.queryByTestId('detail-page')).toBeNull();
  });

  it('currentView="list" 渲染 ProjectListView', () => {
    mockCurrentView = 'list';
    render(<ProgressShell />);
    expect(screen.getByTestId('list-view')).toBeInTheDocument();
    expect(screen.queryByTestId('kanban-view')).toBeNull();
  });

  it('currentView="gantt" 渲染 GanttView', () => {
    mockCurrentView = 'gantt';
    render(<ProgressShell />);
    expect(screen.getByTestId('gantt-view')).toBeInTheDocument();
  });

  it('currentView="notifications" 渲染 NotificationsCenterView', () => {
    mockCurrentView = 'notifications';
    render(<ProgressShell />);
    expect(screen.getByTestId('notifications-view')).toBeInTheDocument();
  });

  it('currentView="earnings" 渲染 EarningsView', () => {
    mockCurrentView = 'earnings';
    render(<ProgressShell />);
    expect(screen.getByTestId('earnings-view')).toBeInTheDocument();
  });

  it('selectedProjectId !== null 且项目存在时渲染 ProjectDetailPage', () => {
    mockSelectedProjectId = 5;
    render(<ProgressShell />);
    const detail = screen.getByTestId('detail-page');
    expect(detail).toBeInTheDocument();
    expect(detail.getAttribute('data-project-id')).toBe('5');
    // 不应渲染 kanban
    expect(screen.queryByTestId('kanban-view')).toBeNull();
  });

  it('详情页时 ViewBar mode="detail"', () => {
    mockSelectedProjectId = 5;
    render(<ProgressShell />);
    const vb = screen.getByTestId('view-bar');
    expect(vb.getAttribute('data-mode')).toBe('detail');
  });

  it('ViewBar detail 模式点返回 → 调 closeProject', async () => {
    mockSelectedProjectId = 5;
    render(<ProgressShell />);
    const backBtn = screen.getByTestId('view-bar-back');
    await userEvent.click(backBtn);
    expect(mockCloseProject).toHaveBeenCalledOnce();
  });

  it('无选中项目时 ViewBar mode="kanban"', () => {
    render(<ProgressShell />);
    const vb = screen.getByTestId('view-bar');
    expect(vb.getAttribute('data-mode')).toBe('kanban');
  });

  it('PipelineStepper + Toast 始终渲染', () => {
    render(<ProgressShell />);
    expect(screen.getByTestId('pipeline-stepper')).toBeInTheDocument();
    expect(screen.getByTestId('toast')).toBeInTheDocument();
  });
});
