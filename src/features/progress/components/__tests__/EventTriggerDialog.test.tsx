/**
 * @file EventTriggerDialog.test.tsx
 * @description EventTriggerDialog 组件单测
 *              覆盖：a11y / 自动 focus / ESC 关闭 / 不同 EventCode 字段渲染 /
 *                    zod 客户端校验 / 提交成功路径 / 提交失败路径 / transition pill
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { render, screen, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { EventTriggerDialog } from '../EventTriggerDialog';
import { useProjectsStore } from '../../stores/projectsStore';
import { useToastStore } from '../../stores/toastStore';
import type { Project } from '../../api/projects';

// 默认 mock：triggerEvent 成功返回最小 Project；每条用例可重写
function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 1,
    name: '测试项目',
    customerLabel: '客户A',
    description: '',
    priority: 'normal',
    status: 'developing',
    deadline: '2026-12-31',
    dealingAt: '2026-01-01',
    originalQuote: '0',
    currentQuote: '0',
    afterSalesTotal: '0',
    totalReceived: '0',
    createdBy: 1,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

beforeEach(() => {
  // 注入可控的 triggerEvent / toast；避免真实 fetch
  useProjectsStore.setState({
    triggerEvent: vi.fn(async () => makeProject()),
  });
  useToastStore.setState({ message: null, visible: false });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('EventTriggerDialog · a11y 与基础渲染', () => {
  it('role=dialog + aria-modal=true + aria-labelledby 指向标题节点', () => {
    render(
      <EventTriggerDialog
        projectId={1}
        fromStatus="developing"
        event="E7"
        eventLabel="标记开发完成"
        onClose={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelId = dialog.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    const title = document.getElementById(labelId!);
    expect(title?.textContent).toBe('标记开发完成');
  });

  it('transition 行渲染 from + to status pill + eventCode 角标', () => {
    render(
      <EventTriggerDialog
        projectId={1}
        fromStatus="developing"
        event="E7"
        eventLabel="标记开发完成"
        onClose={vi.fn()}
      />,
    );
    const transition = screen.getByTestId('event-transition');
    // from = developing → 中文 "开发中"；to = E7 transitionTo 是 confirming → "验收"
    expect(transition.textContent).toContain('开发中');
    expect(transition.textContent).toContain('验收');
    expect(transition.textContent).toContain('E7');
  });

  it('首个字段（textarea）自动 focus', async () => {
    render(
      <EventTriggerDialog
        projectId={1}
        fromStatus="developing"
        event="E7"
        eventLabel="标记开发完成"
        onClose={vi.fn()}
      />,
    );
    // E7 fields 仅一个 note(textarea, required)
    const textarea = screen.getByLabelText(/交付说明/);
    expect(document.activeElement).toBe(textarea);
  });
});

describe('EventTriggerDialog · 不同 EventCode 字段动态渲染', () => {
  it('E1 提交报价评估 → 渲染金额(number) + 评估说明(textarea)', () => {
    render(
      <EventTriggerDialog
        projectId={1}
        fromStatus="dealing"
        event="E1"
        eventLabel="提交报价评估"
        onClose={vi.fn()}
      />,
    );
    const amount = screen.getByLabelText(/预估金额/) as HTMLInputElement;
    expect(amount.type).toBe('number');
    const note = screen.getByLabelText(/评估说明/) as HTMLTextAreaElement;
    expect(note.tagName).toBe('TEXTAREA');
  });

  it('E10 确认收款 → 渲染金额(number) + 支付方式(select 含 5 选项) + 备注(textarea)', () => {
    render(
      <EventTriggerDialog
        projectId={1}
        fromStatus="delivered"
        event="E10"
        eventLabel="确认收款"
        onClose={vi.fn()}
      />,
    );
    const amount = screen.getByLabelText(/收款金额/) as HTMLInputElement;
    expect(amount.type).toBe('number');
    const method = screen.getByLabelText(/支付方式/) as HTMLSelectElement;
    expect(method.tagName).toBe('SELECT');
    // 占位 1 个 + 5 个选项
    expect(method.options).toHaveLength(6);
    expect(screen.getByLabelText(/^备注/)).toBeInTheDocument();
  });

  it('E12 取消项目 → 仅一个 textarea(取消原因 *)', () => {
    render(
      <EventTriggerDialog
        projectId={1}
        fromStatus="dealing"
        event="E12"
        eventLabel="取消项目"
        onClose={vi.fn()}
      />,
    );
    const reason = screen.getByLabelText(/取消原因/);
    expect(reason.tagName).toBe('TEXTAREA');
    // 只 1 个 field（label 都会渲染）
    const labels = screen.getAllByText(/\*$/);
    expect(labels.length).toBe(1);
  });
});

describe('EventTriggerDialog · zod 客户端校验', () => {
  it('空 required 字段提交 → 显示"此字段必填"+ triggerEvent 不被调用', async () => {
    const triggerEvent = vi.fn();
    useProjectsStore.setState({ triggerEvent });
    render(
      <EventTriggerDialog
        projectId={1}
        fromStatus="developing"
        event="E7"
        eventLabel="标记开发完成"
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '确认提交' }));
    expect(screen.getByTestId('field-error-note')).toHaveTextContent('此字段必填');
    expect(triggerEvent).not.toHaveBeenCalled();
  });

  it('E1 仅填金额漏 note → note 字段错误显示，金额无错误', async () => {
    const triggerEvent = vi.fn();
    useProjectsStore.setState({ triggerEvent });
    render(
      <EventTriggerDialog
        projectId={1}
        fromStatus="dealing"
        event="E1"
        eventLabel="提交报价评估"
        onClose={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText(/预估金额/), '8000');
    await userEvent.click(screen.getByRole('button', { name: '确认提交' }));
    expect(screen.getByTestId('field-error-note')).toBeInTheDocument();
    expect(screen.queryByTestId('field-error-estimatedAmount')).toBeNull();
    expect(triggerEvent).not.toHaveBeenCalled();
  });
});

describe('EventTriggerDialog · 提交成功 / 失败路径', () => {
  it('填齐 required → triggerEvent 调用 + onSuccess + showToast + onClose', async () => {
    const triggerEvent = vi.fn(async () => makeProject({ status: 'confirming' }));
    useProjectsStore.setState({ triggerEvent });
    const showToast = vi.fn();
    useToastStore.setState({ show: showToast });

    const onClose = vi.fn();
    const onSuccess = vi.fn();

    render(
      <EventTriggerDialog
        projectId={42}
        fromStatus="developing"
        event="E7"
        eventLabel="标记开发完成"
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    await userEvent.type(screen.getByLabelText(/交付说明/), '交付了第一章');
    await userEvent.click(screen.getByRole('button', { name: '确认提交' }));

    expect(triggerEvent).toHaveBeenCalledOnce();
    expect(triggerEvent).toHaveBeenCalledWith(42, {
      event: 'E7',
      remark: '交付了第一章',
      newHolderUserId: null,
    });
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    // toast 文案含 "标记开发完成 完成 · 开发中 → 验收"
    expect(showToast).toHaveBeenCalledOnce();
    const toastArg = showToast.mock.calls[0][0] as string;
    expect(toastArg).toContain('标记开发完成');
    expect(toastArg).toContain('开发中');
    expect(toastArg).toContain('验收');
  });

  it('多字段提交时其它字段拼成 [fields] JSON 附加到 remark', async () => {
    const triggerEvent = vi.fn(async () => makeProject({ status: 'paid' }));
    useProjectsStore.setState({ triggerEvent });
    render(
      <EventTriggerDialog
        projectId={9}
        fromStatus="delivered"
        event="E10"
        eventLabel="确认收款"
        onClose={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText(/收款金额/), '5000');
    await userEvent.selectOptions(screen.getByLabelText(/支付方式/), '微信');
    await userEvent.type(screen.getByLabelText(/^备注/), '尾款已收');
    await userEvent.click(screen.getByRole('button', { name: '确认提交' }));

    expect(triggerEvent).toHaveBeenCalledOnce();
    const call = triggerEvent.mock.calls[0] as unknown as [number, { event: string; remark: string }];
    const payload = call[1];
    expect(payload.event).toBe('E10');
    expect(payload.remark).toContain('尾款已收');
    expect(payload.remark).toContain('[fields]');
    // 解析 [fields] 后的 JSON
    const idx = payload.remark.indexOf('[fields]');
    const json = payload.remark.slice(idx + '[fields]'.length);
    const parsed = JSON.parse(json);
    expect(parsed.amount).toBe('5000');
    expect(parsed.method).toBe('微信');
  });

  it('triggerEvent 抛错 → submitError 显示 + 弹窗保持打开 + onSuccess 不调用', async () => {
    const triggerEvent = vi.fn(async () => {
      throw new Error('权限不足');
    });
    useProjectsStore.setState({ triggerEvent });
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(
      <EventTriggerDialog
        projectId={1}
        fromStatus="developing"
        event="E7"
        eventLabel="标记开发完成"
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );
    await userEvent.type(screen.getByLabelText(/交付说明/), '随便填');
    await userEvent.click(screen.getByRole('button', { name: '确认提交' }));

    expect(screen.getByTestId('submit-error')).toHaveTextContent('权限不足');
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('EventTriggerDialog · 关闭交互', () => {
  it('ESC 触发 onClose', () => {
    const onClose = vi.fn();
    render(
      <EventTriggerDialog
        projectId={1}
        fromStatus="developing"
        event="E7"
        eventLabel="标记开发完成"
        onClose={onClose}
      />,
    );
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('点击 × 关闭按钮 → onClose', async () => {
    const onClose = vi.fn();
    render(
      <EventTriggerDialog
        projectId={1}
        fromStatus="developing"
        event="E7"
        eventLabel="标记开发完成"
        onClose={onClose}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('点击「取消」按钮 → onClose', async () => {
    const onClose = vi.fn();
    render(
      <EventTriggerDialog
        projectId={1}
        fromStatus="developing"
        event="E7"
        eventLabel="标记开发完成"
        onClose={onClose}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
