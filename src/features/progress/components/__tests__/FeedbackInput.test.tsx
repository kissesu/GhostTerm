/**
 * @file FeedbackInput.test.tsx
 * @description FeedbackInput 单测：
 *              空内容时提交按钮 disabled / 输入后按钮启用 / 提交成功后清空内容 /
 *              提交失败显示 error / add store 被正确调用
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { FeedbackInput } from '../FeedbackInput';

const mockAdd = vi.fn();

vi.mock('../../stores/feedbacksStore', () => ({
  useFeedbacksStore: (selector: (s: object) => unknown) =>
    selector({ add: mockAdd }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('FeedbackInput', () => {
  beforeEach(() => {
    // 默认提交成功
    mockAdd.mockResolvedValue({ id: 1, content: '测试内容', source: 'wechat', status: 'pending', projectId: 1, recordedBy: 1, recordedAt: '2026-05-01T00:00:00Z', attachmentIds: [] });
  });

  it('初始状态：提交按钮 disabled（内容为空）', () => {
    render(<FeedbackInput projectId={1} />);
    const btn = screen.getByRole('button', { name: '提交' });
    expect(btn).toBeDisabled();
  });

  it('输入内容后提交按钮启用', async () => {
    render(<FeedbackInput projectId={1} />);
    const textarea = screen.getByRole('textbox', { name: '反馈内容' });
    await userEvent.type(textarea, '有问题');
    const btn = screen.getByRole('button', { name: '提交' });
    expect(btn).not.toBeDisabled();
  });

  it('提交后调用 store.add 并清空 textarea', async () => {
    render(<FeedbackInput projectId={5} />);
    const textarea = screen.getByRole('textbox', { name: '反馈内容' });
    await userEvent.type(textarea, '新反馈内容');
    await userEvent.click(screen.getByRole('button', { name: '提交' }));
    expect(mockAdd).toHaveBeenCalledWith(5, { content: '新反馈内容', source: 'wechat' });
    // 提交成功后内容清空
    expect(textarea).toHaveValue('');
  });

  it('source select 可以切换来源', async () => {
    render(<FeedbackInput projectId={1} />);
    const select = screen.getByRole('combobox', { name: '反馈来源' });
    await userEvent.selectOptions(select, '电话');
    expect(select).toHaveValue('phone');
  });

  it('提交时 source=phone 正确传给 store.add', async () => {
    render(<FeedbackInput projectId={2} />);
    const textarea = screen.getByRole('textbox', { name: '反馈内容' });
    await userEvent.type(textarea, '电话反馈');
    const select = screen.getByRole('combobox', { name: '反馈来源' });
    await userEvent.selectOptions(select, '电话');
    await userEvent.click(screen.getByRole('button', { name: '提交' }));
    expect(mockAdd).toHaveBeenCalledWith(2, { content: '电话反馈', source: 'phone' });
  });

  it('提交失败时显示错误信息', async () => {
    mockAdd.mockRejectedValue(new Error('服务器错误'));
    render(<FeedbackInput projectId={1} />);
    const textarea = screen.getByRole('textbox', { name: '反馈内容' });
    await userEvent.type(textarea, '失败反馈');
    await userEvent.click(screen.getByRole('button', { name: '提交' }));
    expect(await screen.findByText('服务器错误')).toBeInTheDocument();
  });

  it('仅空白字符不触发 store.add', async () => {
    render(<FeedbackInput projectId={1} />);
    const textarea = screen.getByRole('textbox', { name: '反馈内容' });
    await userEvent.type(textarea, '   ');
    const btn = screen.getByRole('button', { name: '提交' });
    // trim 后为空，按钮仍 disabled
    expect(btn).toBeDisabled();
    expect(mockAdd).not.toHaveBeenCalled();
  });
});
