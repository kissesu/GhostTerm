/**
 * @file EventTriggerDialog.test.tsx
 * @description Phase 11 事件触发对话框单测：
 *              - 必填 note：空备注 submit 时显示错误，store.triggerEvent 不被调用
 *              - 提交成功 → 调 triggerProjectEvent + onSuccess + onClose
 *              - 失败 → 显示 error，不关闭弹窗
 *              - 焦点陷阱：mount 后 textarea 自动 focus
 *              - Escape 键关闭弹窗
 *              - Tab/Shift+Tab 在弹窗内循环
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

import { EventTriggerDialog } from '../EventTriggerDialog';
import { triggerProjectEvent } from '../../api/projects';
import { useProjectsStore } from '../../stores/projectsStore';
import type { Project } from '../../api/projects';

const mockedTrigger = vi.mocked(triggerProjectEvent);

function makeProject(): Project {
  return {
    id: 1,
    name: 'X',
    customerLabel: '测试客户',
    description: 'd',
    priority: 'normal',
    status: 'quoting',
    deadline: '2026-12-31T00:00:00Z',
    dealingAt: '2026-04-29T00:00:00Z',
    originalQuote: '0.00',
    currentQuote: '0.00',
    afterSalesTotal: '0.00',
    totalReceived: '0.00',
    createdBy: 1,
    createdAt: '2026-04-29T00:00:00Z',
    updatedAt: '2026-04-29T00:00:00Z',
  };
}

beforeEach(() => {
  useProjectsStore.getState().clear();
  mockedTrigger.mockReset();
});

describe('EventTriggerDialog 必填校验', () => {
  it('空备注提交：显示错误 + 不调 store.triggerEvent', async () => {
    render(
      <EventTriggerDialog
        projectId={1}
        event="E1"
        eventLabel="提交报价评估"
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('event-trigger-submit'));
    expect(await screen.findByTestId('event-trigger-error')).toHaveTextContent('备注不能为空');
    expect(mockedTrigger).not.toHaveBeenCalled();
  });

  it('仅空白字符的备注被视为空（trim 判定）', async () => {
    render(
      <EventTriggerDialog
        projectId={1}
        event="E1"
        eventLabel="提交报价评估"
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId('event-trigger-note'), {
      target: { value: '   \n  ' },
    });
    fireEvent.click(screen.getByTestId('event-trigger-submit'));

    expect(await screen.findByTestId('event-trigger-error')).toBeInTheDocument();
    expect(mockedTrigger).not.toHaveBeenCalled();
  });
});

describe('EventTriggerDialog 提交成功', () => {
  it('提交成功 → 调 triggerProjectEvent + onSuccess + onClose', async () => {
    mockedTrigger.mockResolvedValueOnce(makeProject());
    const onSuccess = vi.fn();
    const onClose = vi.fn();

    render(
      <EventTriggerDialog
        projectId={42}
        event="E1"
        eventLabel="提交报价评估"
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    fireEvent.change(screen.getByTestId('event-trigger-note'), {
      target: { value: '客户接受报价' },
    });
    fireEvent.click(screen.getByTestId('event-trigger-submit'));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockedTrigger).toHaveBeenCalledWith(42, {
      event: 'E1',
      remark: '客户接受报价',
      newHolderUserId: null,
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});

describe('EventTriggerDialog 提交失败', () => {
  it('失败时显示错误 + 不关闭弹窗', async () => {
    mockedTrigger.mockRejectedValueOnce(new Error('状态机非法迁移'));
    const onClose = vi.fn();

    render(
      <EventTriggerDialog
        projectId={1}
        event="E1"
        eventLabel="提交报价评估"
        onClose={onClose}
      />,
    );

    fireEvent.change(screen.getByTestId('event-trigger-note'), {
      target: { value: '试试看' },
    });
    fireEvent.click(screen.getByTestId('event-trigger-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('event-trigger-error')).toHaveTextContent('状态机非法迁移'),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('EventTriggerDialog a11y', () => {
  it('根节点有 role="dialog" + aria-modal="true" + aria-labelledby 指向 eventLabel', () => {
    render(<EventTriggerDialog projectId={1} event="E1" eventLabel="提交报价评估" onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const titleId = dialog.getAttribute('aria-labelledby');
    expect(titleId).toBeTruthy();
    expect(document.getElementById(titleId!)).toHaveTextContent('提交报价评估');
  });

  it('打开时第一个表单字段获得焦点（既有 noteRef 行为）', () => {
    render(<EventTriggerDialog projectId={1} event="E1" eventLabel="提交报价评估" onClose={vi.fn()} />);
    expect(screen.getByLabelText(/事件备注|备注/)).toHaveFocus();
  });

  it('ESC 键关闭弹窗（既有 handleKeyDown 行为）', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<EventTriggerDialog projectId={1} event="E1" eventLabel="提交报价评估" onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('EventTriggerDialog 焦点陷阱', () => {
  it('mount 后 textarea 自动 focus', async () => {
    render(
      <EventTriggerDialog
        projectId={1}
        event="E1"
        eventLabel="提交报价评估"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('event-trigger-note'));
    });
  });

  it('Escape 键触发 onClose', () => {
    const onClose = vi.fn();
    render(
      <EventTriggerDialog
        projectId={1}
        event="E1"
        eventLabel="提交报价评估"
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(screen.getByTestId('event-trigger-dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Tab 在最后一个元素（提交按钮）上时循环回 textarea', async () => {
    render(
      <EventTriggerDialog
        projectId={1}
        event="E1"
        eventLabel="提交报价评估"
        onClose={vi.fn()}
      />,
    );

    const textarea = screen.getByTestId('event-trigger-note');
    const submit = screen.getByTestId('event-trigger-submit');

    // 模拟焦点在提交按钮 → 按 Tab → 焦点应回到 textarea（第一个可聚焦元素）
    submit.focus();
    expect(document.activeElement).toBe(submit);

    fireEvent.keyDown(screen.getByTestId('event-trigger-dialog'), { key: 'Tab' });
    expect(document.activeElement).toBe(textarea);
  });

  it('Shift+Tab 在第一个元素（textarea）上时循环到提交按钮', () => {
    render(
      <EventTriggerDialog
        projectId={1}
        event="E1"
        eventLabel="提交报价评估"
        onClose={vi.fn()}
      />,
    );

    const textarea = screen.getByTestId('event-trigger-note');
    const submit = screen.getByTestId('event-trigger-submit');

    textarea.focus();
    fireEvent.keyDown(screen.getByTestId('event-trigger-dialog'), {
      key: 'Tab',
      shiftKey: true,
    });
    expect(document.activeElement).toBe(submit);
  });
});
