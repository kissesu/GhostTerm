/**
 * @file ProjectCreateDialog.test.tsx
 * @description Phase 5 项目创建对话框 RTL 单测：
 *              - open=false 不渲染
 *              - 必填字段表单校验
 *              - 提交后调 store.create + 关闭弹窗 + 触发 onCreated
 *              - 失败时显示错误提示
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// ============================================
// mock api/projects（projectsStore 内部调用）
// ============================================
vi.mock('../../api/projects', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    listProjects: vi.fn(),
    createProject: vi.fn(),
    getProject: vi.fn(),
    updateProject: vi.fn(),
    triggerProjectEvent: vi.fn(),
  };
});

import { createProject, type Project } from '../../api/projects';
import { useProjectsStore } from '../../stores/projectsStore';
import { ProjectCreateDialog } from '../ProjectCreateDialog';

const mockedCreate = vi.mocked(createProject);

beforeEach(() => {
  useProjectsStore.getState().clear();
  mockedCreate.mockReset();
});

function makeReturned(): Project {
  return {
    id: 100,
    name: '示例',
    customerLabel: '测试客户',
    description: '描述',
    priority: 'normal',
    status: 'dealing',
    deadline: '2026-12-31T00:00:00.000Z',
    dealingAt: '2026-04-29T00:00:00.000Z',
    originalQuote: '0.00',
    currentQuote: '0.00',
    afterSalesTotal: '0.00',
    totalReceived: '0.00',
    createdBy: 1,
    createdAt: '2026-04-29T00:00:00.000Z',
    updatedAt: '2026-04-29T00:00:00.000Z',
  };
}

// ============================================
// open=false 不渲染
// ============================================

describe('ProjectCreateDialog open prop', () => {
  it('open=false 时不渲染 DOM', () => {
    const { container } = render(
      <ProjectCreateDialog open={false} onClose={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('open=true 时渲染表单', () => {
    render(<ProjectCreateDialog open onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: '新建项目' })).toBeInTheDocument();
    expect(screen.getByTestId('project-name-input')).toBeInTheDocument();
  });
});

// ============================================
// 必填字段校验：缺 name 时不调 api
// ============================================

describe('ProjectCreateDialog 表单校验', () => {
  it('缺名称时不调 api 并显示错误', async () => {
    const onClose = vi.fn();
    render(<ProjectCreateDialog open onClose={onClose} />);

    // 不填 name，直接填其它必填，提交
    fireEvent.change(screen.getByTestId('project-customer-input'), { target: { value: '客户A' } });
    fireEvent.change(screen.getByTestId('project-description-input'), { target: { value: 'desc' } });
    fireEvent.change(screen.getByTestId('project-deadline-input'), {
      target: { value: '2026-12-31T00:00' },
    });
    fireEvent.click(screen.getByTestId('project-submit-btn'));

    expect(await screen.findByRole('alert')).toHaveTextContent('请填写项目名称');
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('客户标签为空时报错', async () => {
    render(<ProjectCreateDialog open onClose={() => {}} />);
    fireEvent.change(screen.getByTestId('project-name-input'), { target: { value: 'demo' } });
    fireEvent.change(screen.getByTestId('project-customer-input'), { target: { value: '' } });
    fireEvent.change(screen.getByTestId('project-description-input'), { target: { value: 'd' } });
    fireEvent.change(screen.getByTestId('project-deadline-input'), {
      target: { value: '2026-12-31T00:00' },
    });
    fireEvent.click(screen.getByTestId('project-submit-btn'));

    expect(await screen.findByRole('alert')).toHaveTextContent('请填写客户标签');
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});

// ============================================
// 成功提交：调 api + 触发回调 + 关闭
// ============================================

describe('ProjectCreateDialog 提交成功路径', () => {
  it('表单合法时调 createProject 并 onClose / onCreated', async () => {
    mockedCreate.mockResolvedValueOnce(makeReturned());
    const onClose = vi.fn();
    const onCreated = vi.fn();

    render(<ProjectCreateDialog open onClose={onClose} onCreated={onCreated} />);

    fireEvent.change(screen.getByTestId('project-name-input'), { target: { value: 'demo' } });
    fireEvent.change(screen.getByTestId('project-customer-input'), { target: { value: '测试客户' } });
    fireEvent.change(screen.getByTestId('project-description-input'), { target: { value: 'desc' } });
    fireEvent.change(screen.getByTestId('project-deadline-input'), {
      target: { value: '2026-12-31T00:00' },
    });
    fireEvent.change(screen.getByTestId('project-priority-select'), {
      target: { value: 'urgent' },
    });
    fireEvent.click(screen.getByTestId('project-submit-btn'));

    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledTimes(1);
    });
    const callArgs = mockedCreate.mock.calls[0]?.[0];
    expect(callArgs?.name).toBe('demo');
    expect(callArgs?.customerLabel).toBe('测试客户');
    expect(callArgs?.priority).toBe('urgent');

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(makeReturned());
      expect(onClose).toHaveBeenCalled();
    });

    // store 已写入
    expect(useProjectsStore.getState().selectByID(100)).toBeDefined();
  });
});

// ============================================
// 提交失败：显示 error，不关闭
// ============================================

describe('ProjectCreateDialog 提交失败路径', () => {
  it('api 拒绝时显示错误且不关闭弹窗', async () => {
    mockedCreate.mockRejectedValueOnce(new Error('customer not found'));
    const onClose = vi.fn();
    render(<ProjectCreateDialog open onClose={onClose} />);

    fireEvent.change(screen.getByTestId('project-name-input'), { target: { value: 'demo' } });
    fireEvent.change(screen.getByTestId('project-customer-input'), { target: { value: '客户A' } });
    fireEvent.change(screen.getByTestId('project-description-input'), { target: { value: 'desc' } });
    fireEvent.change(screen.getByTestId('project-deadline-input'), {
      target: { value: '2026-12-31T00:00' },
    });
    fireEvent.click(screen.getByTestId('project-submit-btn'));

    expect(await screen.findByRole('alert')).toHaveTextContent('customer not found');
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ============================================
// 取消按钮：触发 onClose
// ============================================

describe('ProjectCreateDialog 取消', () => {
  it('点击取消调 onClose 不调 api', () => {
    const onClose = vi.fn();
    render(<ProjectCreateDialog open onClose={onClose} />);
    fireEvent.click(screen.getByTestId('project-cancel-btn'));
    expect(onClose).toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});
