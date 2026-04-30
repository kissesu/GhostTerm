/**
 * @file ProjectDetailPage.test.tsx
 * @description ProjectDetailPage 单测 — 覆盖 NBA reason 接 feedbacksStore.byProject（W7）。
 *
 *              测试策略：
 *              1. mock api/projects（getProject）让 loadOne 能立即 resolve
 *              2. 通过 useFeedbacksStore.setState 注入反馈数据
 *              3. mock PermissionGate 直通 children，避免权限分支干扰
 *              4. 用 vi.useFakeTimers() 固定"今天"到 2026-05-01
 *
 * @author Atlas.oi
 * @date 2026-04-30
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

// PermissionGate 直通：测试不关心权限分支
vi.mock('../PermissionGate', () => ({
  PermissionGate: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// mock 整个 api/projects，让 loadOne 不真正发 HTTP
vi.mock('../../api/projects', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    // getProject 由各测试用例 mock 覆盖
    getProject: vi.fn(),
    listProjects: vi.fn().mockResolvedValue([]),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    triggerProjectEvent: vi.fn(),
  };
});

// EventTriggerDialog 只要渲染不崩溃即可，整体 mock 掉
vi.mock('../EventTriggerDialog', () => ({
  EventTriggerDialog: () => null,
}));

// FeedbackInput / FeedbackList / ThesisVersionList 均有自己的 useEffect+API，mock 掉避免副作用
vi.mock('../FeedbackInput', () => ({ FeedbackInput: () => null }));
vi.mock('../FeedbackList', () => ({ FeedbackList: () => null }));
vi.mock('../ThesisVersionList', () => ({ ThesisVersionList: () => null }));
vi.mock('../FileUploadButton', () => ({ FileUploadButton: () => null }));

import { ProjectDetailPage } from '../ProjectDetailPage';
import { useProjectsStore } from '../../stores/projectsStore';
import { useProgressUiStore } from '../../stores/progressUiStore';
import { useFeedbacksStore } from '../../stores/feedbacksStore';
import { getProject as mockGetProject } from '../../api/projects';
import type { Project } from '../../api/projects';
import type { Feedback } from '../../api/feedbacks';

const mocked = vi.mocked(mockGetProject);

/** 构造最小合法 Project，status 可覆盖 */
function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: 1,
    name: '测试项目',
    customerLabel: '张三@wx',
    description: '',
    priority: 'normal',
    status: 'developing',
    deadline: '2026-12-31T00:00:00.000Z',
    dealingAt: '2026-04-01T00:00:00.000Z',
    originalQuote: '8000.00',
    currentQuote: '8000.00',
    afterSalesTotal: '0.00',
    totalReceived: '0.00',
    createdBy: 1,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    holderUserId: null,
    holderRoleId: null,
    ...over,
  };
}

/** 构造最小合法 Feedback */
function makeFeedback(projectId: number, recordedAt: string): Feedback {
  return {
    id: 1,
    projectId,
    content: '测试反馈内容',
    source: 'wechat',
    status: 'pending',
    recordedBy: 1,
    recordedAt,
    attachmentIds: [],
  };
}

/**
 * 把 project 注入 projectsStore（模拟 loadOne 完成后的状态），
 * 同时让 mocked getProject 立即 resolve 同一个 project（保证 loadOne 不阻塞）。
 */
function seedProject(project: Project): void {
  // 预先填入 store，避免组件停留在 loading 分支
  useProjectsStore.setState((state) => {
    const next = new Map(state.projects);
    next.set(project.id, project);
    return { projects: next };
  });
  // loadOne 也能 resolve（useEffect 内 loadProject 调用）
  mocked.mockResolvedValue(project);
}

beforeEach(() => {
  // 仅伪造 Date，不替换 setTimeout / Promise（保证 waitFor / RTL 可正常运转）
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-05-01T12:00:00Z'));

  // 重置 store
  useProjectsStore.getState().clear();
  useProgressUiStore.getState().reset();
  useFeedbacksStore.getState().clear();
  mocked.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================================
// NBA reason 派生——W7 任务核心测试
// ============================================================================

describe('NBA reason 接 feedbacksStore.byProject（W7）', () => {
  it('developing 项目 + 5 天前最后反馈 → reason 包含"已 5 天无新反馈"或"建议主动联系"', async () => {
    // 最后反馈时间：2026-04-26，距今（2026-05-01）恰好 5 天
    const feedback = makeFeedback(1, '2026-04-26T12:00:00Z');
    useFeedbacksStore.setState({
      byProject: new Map([[1, [feedback]]]),
      loadingByProject: new Set(),
      errorByProject: new Map(),
    });

    const project = makeProject({ id: 1, status: 'developing' });
    seedProject(project);

    render(<ProjectDetailPage projectId={1} />);

    // waitFor 等 loadProject useEffect 完成 + NbaPanel 渲染
    await waitFor(() => {
      expect(screen.getByTestId('nba-panel')).toBeInTheDocument();
    });

    // deriveReason(developing, { daysSinceLastActivity: 5 }) → 含"已 5 天无新反馈"
    const panel = screen.getByTestId('nba-panel');
    expect(panel.textContent).toMatch(/已\s*5\s*天无新反馈|建议主动联系/);
  });

  it('developing 项目 + 无反馈数据 → reason 显示 NBA_CONFIG.developing.defaultReason', async () => {
    // byProject 无该项目数据
    useFeedbacksStore.setState({
      byProject: new Map(),
      loadingByProject: new Set(),
      errorByProject: new Map(),
    });

    const project = makeProject({ id: 1, status: 'developing' });
    seedProject(project);

    render(<ProjectDetailPage projectId={1} />);

    await waitFor(() => {
      expect(screen.getByTestId('nba-panel')).toBeInTheDocument();
    });

    // defaultReason: '当前正在开发中。完成后请标记开发完成提交客户验收。'
    const panel = screen.getByTestId('nba-panel');
    expect(panel.textContent).toMatch(/当前正在开发中|完成后请标记开发完成/);
  });

  it('developing 项目 + 4 天前反馈（不满 5 天阈值）→ 显示 defaultReason', async () => {
    // 4 天前：阈值为 >= 5，应走 defaultReason
    const feedback = makeFeedback(1, '2026-04-27T12:00:00Z');
    useFeedbacksStore.setState({
      byProject: new Map([[1, [feedback]]]),
      loadingByProject: new Set(),
      errorByProject: new Map(),
    });

    const project = makeProject({ id: 1, status: 'developing' });
    seedProject(project);

    render(<ProjectDetailPage projectId={1} />);

    await waitFor(() => {
      expect(screen.getByTestId('nba-panel')).toBeInTheDocument();
    });

    // 4 天未达阈值，显示 defaultReason
    const panel = screen.getByTestId('nba-panel');
    expect(panel.textContent).toMatch(/当前正在开发中|完成后请标记开发完成/);
    // 确认不显示"无新反馈"提示
    expect(panel.textContent).not.toMatch(/已\s*4\s*天无新反馈/);
  });

  it('多条反馈时取最新一条（recordedAt 最大值）计算天数', async () => {
    // 第一条：10 天前；第二条（更新）：5 天前 → 应该用 5 天计算
    const old = makeFeedback(1, '2026-04-21T12:00:00Z');
    const recent: Feedback = { ...makeFeedback(1, '2026-04-26T12:00:00Z'), id: 2 };
    useFeedbacksStore.setState({
      byProject: new Map([[1, [old, recent]]]),
      loadingByProject: new Set(),
      errorByProject: new Map(),
    });

    const project = makeProject({ id: 1, status: 'developing' });
    seedProject(project);

    render(<ProjectDetailPage projectId={1} />);

    await waitFor(() => {
      expect(screen.getByTestId('nba-panel')).toBeInTheDocument();
    });

    // 最新反馈是 5 天前 → 触发动态 reason
    const panel = screen.getByTestId('nba-panel');
    expect(panel.textContent).toMatch(/已\s*5\s*天无新反馈|建议主动联系/);
  });
});
