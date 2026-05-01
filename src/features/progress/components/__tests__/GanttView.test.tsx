/**
 * @file GanttView.test.tsx
 * @description GanttView 单测：渲染项目行 / 点击跳详情
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GanttView } from '../GanttView';
import type { Project } from '../../api/projects';

function makeProject(id: number, name: string): Project {
  return {
    id,
    name,
    customerLabel: '客户',
    description: '',
    priority: 'normal',
    status: 'developing',
    deadline: new Date(Date.now() + 20 * 86_400_000).toISOString(),
    dealingAt: '2026-01-01',
    originalQuote: '0',
    currentQuote: '0',
    afterSalesTotal: '0',
    totalReceived: '0',
    createdBy: 1,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };
}

const mockLoadAll = vi.fn();
const mockOpenProjectFromView = vi.fn();
const mockProjects = new Map([[1, makeProject(1, '甘特测试项目')]]);

vi.mock('../../stores/projectsStore', () => ({
  useProjectsStore: (selector: (s: object) => unknown) =>
    selector({ projects: mockProjects, loadAll: mockLoadAll }),
}));

vi.mock('../../stores/progressUiStore', () => ({
  useProgressUiStore: (selector: (s: object) => unknown) =>
    selector({ openProjectFromView: mockOpenProjectFromView }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GanttView', () => {
  it('渲染项目行 name', () => {
    render(<GanttView />);
    expect(screen.getByText('甘特测试项目')).toBeInTheDocument();
  });

  it('点击行 → openProjectFromView(id, "gantt")', async () => {
    render(<GanttView />);
    const row = document.querySelector('[data-project-id="1"]') as HTMLElement;
    await userEvent.click(row);
    expect(mockOpenProjectFromView).toHaveBeenCalledWith(1, 'gantt');
  });
});
