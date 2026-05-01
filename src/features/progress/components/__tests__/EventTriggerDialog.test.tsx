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
  it('空备注提交：显示"此字段必填" + 不调 store.triggerEvent', async () => {
    render(
      <EventTriggerDialog
        projectId={1}
        event="E1"
        eventLabel="提交报价评估"
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('event-trigger-submit'));
    // 重写后 zod 校验改为 per-field"此字段必填"提示，不再走顶部 event-trigger-error
    expect(await screen.findAllByText(/此字段必填/)).toHaveLength(2);
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

    // 评估说明 trim 后为空 → 至少出现一处"此字段必填"
    expect(await screen.findAllByText(/此字段必填/)).not.toHaveLength(0);
    expect(mockedTrigger).not.toHaveBeenCalled();
  });
});

describe('EventTriggerDialog 提交成功', () => {
  it('提交成功 → 调 triggerProjectEvent + onSuccess + onClose（remark 含 [fields] JSON 后缀）', async () => {
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

    // E1 字段：estimatedAmount(number, required) + note(textarea, required)
    fireEvent.change(screen.getByLabelText(/预估金额/), { target: { value: '8000' } });
    fireEvent.change(screen.getByTestId('event-trigger-note'), {
      target: { value: '客户接受报价' },
    });
    fireEvent.click(screen.getByTestId('event-trigger-submit'));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockedTrigger).toHaveBeenCalledTimes(1);
    const [calledId, calledInput] = mockedTrigger.mock.calls[0];
    expect(calledId).toBe(42);
    expect(calledInput.event).toBe('E1');
    expect(calledInput.newHolderUserId).toBeNull();
    // remark = "<note>\n[fields]<json>"，后缀编码非 note 字段（estimatedAmount）
    expect(calledInput.remark).toContain('客户接受报价');
    expect(calledInput.remark).toContain('[fields]');
    expect(calledInput.remark).toContain('"estimatedAmount":"8000"');
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

    fireEvent.change(screen.getByLabelText(/预估金额/), { target: { value: '8000' } });
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

  it('打开时第一个表单字段获得焦点（既有 noteRef 行为：E1 第一个字段为预估金额）', () => {
    render(<EventTriggerDialog projectId={1} event="E1" eventLabel="提交报价评估" onClose={vi.fn()} />);
    expect(screen.getByLabelText(/预估金额/)).toHaveFocus();
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
  it('mount 后第一个字段（E12 唯一字段为 textarea）自动 focus', async () => {
    render(
      <EventTriggerDialog
        projectId={1}
        event="E12"
        eventLabel="取消项目"
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

  it('Tab 在最后一个元素（提交按钮）上时循环回首字段（E12 textarea）', async () => {
    render(
      <EventTriggerDialog
        projectId={1}
        event="E12"
        eventLabel="取消项目"
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

  it('Shift+Tab 在第一个元素（E12 textarea）上时循环到提交按钮', () => {
    render(
      <EventTriggerDialog
        projectId={1}
        event="E12"
        eventLabel="取消项目"
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

describe('EventTriggerDialog 字段校验（C2 + C4）', () => {
  it('E12 取消项目 required note 空值 → 不调 triggerEvent + 显示"必填"提示', async () => {
    const user = userEvent.setup();
    render(
      <EventTriggerDialog projectId={1} event="E12" eventLabel="取消项目" onClose={vi.fn()} />,
    );
    await user.click(screen.getByTestId('event-trigger-submit'));
    expect(mockedTrigger).not.toHaveBeenCalled();
    expect(screen.getByText(/此字段必填/)).toBeInTheDocument();
  });

  it('E1 提交报价评估 多字段：金额 + 评估说明都必填', async () => {
    const user = userEvent.setup();
    render(
      <EventTriggerDialog projectId={1} event="E1" eventLabel="提交报价评估" onClose={vi.fn()} />,
    );
    await user.click(screen.getByTestId('event-trigger-submit'));
    expect(mockedTrigger).not.toHaveBeenCalled();
    // E1 含 estimatedAmount 必填 + note 必填，至少 1 处"此字段必填"
    expect(screen.getAllByText(/此字段必填/).length).toBeGreaterThanOrEqual(1);
  });

  it('填齐 required 字段后提交 → triggerProjectEvent 被调用（E12 取消原因）', async () => {
    const user = userEvent.setup();
    mockedTrigger.mockResolvedValueOnce(makeProject());
    render(
      <EventTriggerDialog projectId={1} event="E12" eventLabel="取消项目" onClose={vi.fn()} />,
    );
    await user.type(screen.getByLabelText(/取消原因/), '测试取消');
    await user.click(screen.getByTestId('event-trigger-submit'));
    await waitFor(() => expect(mockedTrigger).toHaveBeenCalledTimes(1));
  });
});
