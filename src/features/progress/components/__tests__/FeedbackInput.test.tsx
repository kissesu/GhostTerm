/**
 * @file FeedbackInput.test.tsx
 * @description Phase 7 FeedbackInput 组件测试：
 *              - 无 feedback:create 权限时不渲染（PermissionGate 拦截）
 *              - 有权限时渲染 textarea + select + 按钮
 *              - 提交：调 store.create，参数对齐
 *              - 提交后 content 清空、source 保持
 *              - content 为空白时按钮 disabled
 *              - 失败错误展示
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../api/client', () => ({
  apiFetch: vi.fn(),
  ProgressApiError: class extends Error {
    public readonly status: number;
    public readonly code: string;
    public readonly details?: unknown;
    constructor(status: number, code: string, message: string, details?: unknown) {
      super(message);
      this.name = 'ProgressApiError';
      this.status = status;
      this.code = code;
      this.details = details;
    }
  },
  getBaseUrl: () => 'http://test',
}));

import { useFeedbacksStore } from '../../stores/feedbacksStore';
import { useProgressPermissionStore } from '../../stores/progressPermissionStore';
import { FeedbackInput } from '../FeedbackInput';
import { ProgressApiError } from '../../api/client';
import type { Feedback } from '../../api/feedbacks';

const sampleFeedback = (id: number, projectId: number, overrides: Partial<Feedback> = {}): Feedback => ({
  id,
  projectId,
  content: `feedback ${id}`,
  source: 'wechat',
  status: 'pending',
  recordedBy: 1,
  recordedAt: '2026-04-29T10:00:00Z',
  attachmentIds: [],
  ...overrides,
});

beforeEach(() => {
  // 每个用例重置两个 store + 替换 create action 为可控 mock
  useFeedbacksStore.setState({
    byProject: new Map(),
    loadingByProject: new Set(),
    errorByProject: new Map(),
  });
  useProgressPermissionStore.getState().clear();
});

describe('FeedbackInput - 权限守卫', () => {
  it('无 feedback:create 权限时不渲染录入表单', () => {
    // permission store 空 → PermissionGate 不渲染 children
    render(<FeedbackInput projectId={100} />);
    expect(screen.queryByTestId('feedback-input')).toBeNull();
  });

  it('拥有 feedback:create 权限时渲染录入表单', () => {
    useProgressPermissionStore.getState().hydrate(['feedback:create']);
    render(<FeedbackInput projectId={100} />);
    expect(screen.getByTestId('feedback-input')).toBeInTheDocument();
    expect(screen.getByTestId('feedback-input-content')).toBeInTheDocument();
    expect(screen.getByTestId('feedback-input-source')).toBeInTheDocument();
    expect(screen.getByTestId('feedback-input-submit')).toBeInTheDocument();
  });

  it('超管 *:* 通配也能渲染', () => {
    useProgressPermissionStore.getState().hydrate(['*:*']);
    render(<FeedbackInput projectId={100} />);
    expect(screen.getByTestId('feedback-input')).toBeInTheDocument();
  });
});

describe('FeedbackInput - 提交流程', () => {
  beforeEach(() => {
    useProgressPermissionStore.getState().hydrate(['feedback:create']);
  });

  it('content 为空时按钮 disabled', () => {
    render(<FeedbackInput projectId={100} />);
    const submit = screen.getByTestId('feedback-input-submit');
    expect(submit).toBeDisabled();
  });

  it('content 仅空白时按钮仍 disabled', async () => {
    const user = userEvent.setup();
    render(<FeedbackInput projectId={100} />);

    await user.type(screen.getByTestId('feedback-input-content'), '   ');
    const submit = screen.getByTestId('feedback-input-submit');
    expect(submit).toBeDisabled();
  });

  it('提交时调 store.create 携带正确参数', async () => {
    const user = userEvent.setup();
    const fakeCreated = sampleFeedback(99, 100, { content: '客户说字号太小' });
    const createSpy = vi.fn().mockResolvedValue(fakeCreated);
    useFeedbacksStore.setState({ create: createSpy });

    render(<FeedbackInput projectId={100} />);

    await user.type(screen.getByTestId('feedback-input-content'), '客户说字号太小');
    await user.selectOptions(screen.getByTestId('feedback-input-source'), 'phone');
    await user.click(screen.getByTestId('feedback-input-submit'));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledTimes(1);
    });
    expect(createSpy).toHaveBeenCalledWith(100, {
      content: '客户说字号太小',
      source: 'phone',
    });
  });

  it('提交成功后 content 清空、source 保持', async () => {
    const user = userEvent.setup();
    const createSpy = vi.fn().mockResolvedValue(sampleFeedback(1, 100));
    useFeedbacksStore.setState({ create: createSpy });

    render(<FeedbackInput projectId={100} />);

    const textarea = screen.getByTestId('feedback-input-content') as HTMLTextAreaElement;
    const select = screen.getByTestId('feedback-input-source') as HTMLSelectElement;

    await user.selectOptions(select, 'meeting');
    await user.type(textarea, 'first');
    await user.click(screen.getByTestId('feedback-input-submit'));

    await waitFor(() => {
      expect(textarea.value).toBe('');
    });
    expect(select.value).toBe('meeting'); // source 保持上一次选择
  });

  it('content 末尾空白会被 trim 后再发到 store', async () => {
    const user = userEvent.setup();
    const createSpy = vi.fn().mockResolvedValue(sampleFeedback(1, 100));
    useFeedbacksStore.setState({ create: createSpy });

    render(<FeedbackInput projectId={100} />);

    await user.type(screen.getByTestId('feedback-input-content'), '  hello  ');
    await user.click(screen.getByTestId('feedback-input-submit'));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith(100, {
        content: 'hello', // trim 后
        source: 'wechat',
      });
    });
  });

  it('提交失败时显示 store.errorByProject 内容', async () => {
    const user = userEvent.setup();
    const apiErr = new ProgressApiError(422, 'validation_failed', '后端拒绝');
    const createSpy = vi.fn().mockImplementation(async (projectId: number) => {
      // 模拟 store 真实行为：失败时写 errorByProject
      useFeedbacksStore.setState((state) => {
        const errs = new Map(state.errorByProject);
        errs.set(projectId, apiErr.message);
        return { errorByProject: errs };
      });
      throw apiErr;
    });
    useFeedbacksStore.setState({ create: createSpy });

    render(<FeedbackInput projectId={100} />);

    await user.type(screen.getByTestId('feedback-input-content'), 'msg');
    await user.click(screen.getByTestId('feedback-input-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('feedback-input-error')).toHaveTextContent('后端拒绝');
    });
  });
});
