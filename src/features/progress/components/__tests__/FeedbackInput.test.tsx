/**
 * @file FeedbackInput.test.tsx
 * @description FeedbackInput 单测：
 *              空内容时提交按钮 disabled / 输入后按钮启用 / 提交成功后清空内容 /
 *              提交失败显示 error / add store 被正确调用 /
 *              附件上传后 chip 显示 + 删除 + 提交时 attachmentIds 一并提交
 *
 *              source 下拉框已按用户反馈 2026-05-03 删除，相关用例同步移除。
 *
 * @author Atlas.oi
 * @date 2026-05-03
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

// activitiesStore.invalidate 在提交成功路径被调用，需要 mock 避免真实 fetch
const mockInvalidate = vi.fn();
vi.mock('../../stores/activitiesStore', () => ({
  useActivitiesStore: Object.assign(
    (selector: (s: object) => unknown) =>
      selector({
        byProject: new Map(),
        loadActivities: vi.fn(),
        invalidate: mockInvalidate,
      }),
    {
      getState: () => ({
        byProject: new Map(),
        loadActivities: vi.fn(),
        invalidate: mockInvalidate,
      }),
    },
  ),
}));

// uploadFile 在选附件流程被调用；测试用 mock 返回伪 metadata
const mockUploadFile = vi.fn();
vi.mock('../../api/files', () => ({
  uploadFile: (...args: unknown[]) => mockUploadFile(...args),
}));

// ProgressApiError 真身要保留，让 friendlyUploadError 的 instanceof 命中
import { ProgressApiError } from '../../api/client';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // mockResolvedValueOnce / mockRejectedValueOnce 的队列需要显式 reset，
  // clearAllMocks 只清 calls/results 不清 implementation 队列
  mockUploadFile.mockReset();
});

describe('FeedbackInput', () => {
  beforeEach(() => {
    // 默认提交成功
    mockAdd.mockResolvedValue({
      id: 1,
      content: '测试内容',
      source: 'wechat',
      status: 'pending',
      projectId: 1,
      recordedBy: 1,
      recordedAt: '2026-05-01T00:00:00Z',
      attachmentIds: [],
    });
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

  it('提交后调用 store.add 并清空 textarea（不再传 source 字段）', async () => {
    render(<FeedbackInput projectId={5} />);
    const textarea = screen.getByRole('textbox', { name: '反馈内容' });
    await userEvent.type(textarea, '新反馈内容');
    await userEvent.click(screen.getByRole('button', { name: '提交' }));
    expect(mockAdd).toHaveBeenCalledWith(5, { content: '新反馈内容' });
    expect(textarea).toHaveValue('');
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
    expect(btn).toBeDisabled();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('选择附件后显示 chip，提交时 attachmentIds 一并提交', async () => {
    mockUploadFile
      .mockResolvedValueOnce({ id: 11, filename: 'a.png' })
      .mockResolvedValueOnce({ id: 12, filename: 'b.mp4' });
    render(<FeedbackInput projectId={3} />);
    const fileInput = screen.getByLabelText('选择附件') as HTMLInputElement;
    const f1 = new File(['x'], 'a.png', { type: 'image/png' });
    const f2 = new File(['y'], 'b.mp4', { type: 'video/mp4' });
    await userEvent.upload(fileInput, [f1, f2]);

    expect(await screen.findByText('a.png')).toBeInTheDocument();
    expect(screen.getByText('b.mp4')).toBeInTheDocument();

    const textarea = screen.getByRole('textbox', { name: '反馈内容' });
    await userEvent.type(textarea, '带附件的反馈');
    await userEvent.click(screen.getByRole('button', { name: '提交' }));

    expect(mockAdd).toHaveBeenCalledWith(3, {
      content: '带附件的反馈',
      attachmentIds: [11, 12],
    });
  });

  it('单文件上传失败：显示中文错误 + 文件名上下文，成功的仍入 chip', async () => {
    const err = new ProgressApiError(
      415,
      'mime_not_allowed',
      'mime_not_allowed: application/octet-stream',
    );
    mockUploadFile.mockResolvedValueOnce({ id: 31, filename: 'good.png' });
    mockUploadFile.mockRejectedValueOnce(err);
    render(<FeedbackInput projectId={6} />);
    const fileInput = screen.getByLabelText('选择附件') as HTMLInputElement;
    const f1 = new File(['x'], 'good.png', { type: 'image/png' });
    // f2 通过前端 accept（PDF 扩展名）但 mock 后端拒绝（模拟 sniff 落 octet-stream）
    const f2 = new File(['x'], 'bad.pdf', { type: 'application/pdf' });
    await userEvent.upload(fileInput, [f1, f2]);

    // 成功的那个仍进 chip
    expect(await screen.findByText('good.png')).toBeInTheDocument();
    expect(
      await screen.findByText(/bad\.pdf：文件类型不被支持/),
    ).toBeInTheDocument();
    expect(screen.queryByText('bad.pdf')).not.toBeInTheDocument();
  });

  it('点击 × 移除附件后 chip 消失且不传该 id', async () => {
    mockUploadFile.mockResolvedValueOnce({ id: 21, filename: 'doc.pdf' });
    render(<FeedbackInput projectId={4} />);
    const fileInput = screen.getByLabelText('选择附件') as HTMLInputElement;
    await userEvent.upload(fileInput, new File(['x'], 'doc.pdf', { type: 'application/pdf' }));

    expect(await screen.findByText('doc.pdf')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '移除 doc.pdf' }));
    expect(screen.queryByText('doc.pdf')).not.toBeInTheDocument();

    const textarea = screen.getByRole('textbox', { name: '反馈内容' });
    await userEvent.type(textarea, '已删除附件');
    await userEvent.click(screen.getByRole('button', { name: '提交' }));
    expect(mockAdd).toHaveBeenCalledWith(4, { content: '已删除附件' });
  });
});
