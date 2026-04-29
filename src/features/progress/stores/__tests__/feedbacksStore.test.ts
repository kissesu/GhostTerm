/**
 * @file feedbacksStore.test.ts
 * @description Phase 7 feedbacksStore 单测：
 *              - load 成功 → byProject 写入；loading 复位
 *              - load 失败 → errorByProject 记录消息；loading 复位
 *              - create 成功 → append 到对应 project
 *              - create 失败 → errorByProject 记录
 *              - updateStatus → 替换 byProject 中对应行
 *              - clear → 全部清空
 *              - 多 project 隔离：A 的 loading 不影响 B
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================
// mock api 模块（覆盖 listFeedbacks / createFeedback / updateFeedback）
// 注意：vi.mock 工厂会被 hoist 到 import 之前
// ============================================
vi.mock('../../api/feedbacks', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    listFeedbacks: vi.fn(),
    createFeedback: vi.fn(),
    updateFeedback: vi.fn(),
  };
});

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

import { listFeedbacks, createFeedback, updateFeedback } from '../../api/feedbacks';
import type { Feedback } from '../../api/feedbacks';
import { ProgressApiError } from '../../api/client';
import { useFeedbacksStore } from '../feedbacksStore';

const mockedList = vi.mocked(listFeedbacks);
const mockedCreate = vi.mocked(createFeedback);
const mockedUpdate = vi.mocked(updateFeedback);

const sampleFeedback = (id: number, projectId: number, overrides: Partial<Feedback> = {}): Feedback => ({
  id,
  projectId,
  content: `feedback ${id}`,
  source: 'wechat',
  status: 'pending',
  recordedBy: 1,
  recordedAt: `2026-04-29T${String(10 + id).padStart(2, '0')}:00:00Z`,
  attachmentIds: [],
  ...overrides,
});

beforeEach(() => {
  useFeedbacksStore.getState().clear();
  mockedList.mockReset();
  mockedCreate.mockReset();
  mockedUpdate.mockReset();
});

// ============================================
// load
// ============================================
describe('feedbacksStore.load', () => {
  it('成功加载后写入 byProject 并清 loading', async () => {
    const items = [sampleFeedback(1, 100), sampleFeedback(2, 100)];
    mockedList.mockResolvedValueOnce(items);

    await useFeedbacksStore.getState().load(100);

    const state = useFeedbacksStore.getState();
    expect(state.byProject.get(100)).toEqual(items);
    expect(state.loadingByProject.has(100)).toBe(false);
    expect(state.errorByProject.has(100)).toBe(false);
  });

  it('load 失败时记录 errorByProject 并 throw', async () => {
    const apiErr = new ProgressApiError(500, 'internal', '后端炸了');
    mockedList.mockRejectedValueOnce(apiErr);

    await expect(useFeedbacksStore.getState().load(100)).rejects.toBe(apiErr);

    const state = useFeedbacksStore.getState();
    expect(state.errorByProject.get(100)).toBe('后端炸了');
    expect(state.loadingByProject.has(100)).toBe(false);
  });

  it('多次 load 同 project 用最新结果替换', async () => {
    mockedList.mockResolvedValueOnce([sampleFeedback(1, 100)]);
    await useFeedbacksStore.getState().load(100);
    expect(useFeedbacksStore.getState().byProject.get(100)).toHaveLength(1);

    mockedList.mockResolvedValueOnce([
      sampleFeedback(2, 100),
      sampleFeedback(3, 100),
    ]);
    await useFeedbacksStore.getState().load(100);

    const list = useFeedbacksStore.getState().byProject.get(100)!;
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(2);
    expect(list[1].id).toBe(3);
  });

  it('多 project 隔离：A 加载不污染 B', async () => {
    mockedList.mockResolvedValueOnce([sampleFeedback(1, 100)]);
    await useFeedbacksStore.getState().load(100);

    mockedList.mockResolvedValueOnce([sampleFeedback(2, 200), sampleFeedback(3, 200)]);
    await useFeedbacksStore.getState().load(200);

    const state = useFeedbacksStore.getState();
    expect(state.byProject.get(100)).toHaveLength(1);
    expect(state.byProject.get(200)).toHaveLength(2);
  });
});

// ============================================
// create
// ============================================
describe('feedbacksStore.create', () => {
  it('创建成功后 append 到对应 project，并清掉之前错误', async () => {
    // 预置一条已加载 + 一个错误
    useFeedbacksStore.setState({
      byProject: new Map([[100, [sampleFeedback(1, 100)]]]),
      errorByProject: new Map([[100, '上一次失败']]),
    });

    const newFb = sampleFeedback(2, 100, { content: 'new one' });
    mockedCreate.mockResolvedValueOnce(newFb);

    const result = await useFeedbacksStore.getState().create(100, {
      content: 'new one',
      source: 'wechat',
    });

    expect(result).toEqual(newFb);
    const list = useFeedbacksStore.getState().byProject.get(100)!;
    expect(list).toHaveLength(2);
    expect(list[1].id).toBe(2);
    expect(useFeedbacksStore.getState().errorByProject.has(100)).toBe(false);
  });

  it('create 失败时 errorByProject 记录消息，列表不变', async () => {
    useFeedbacksStore.setState({
      byProject: new Map([[100, [sampleFeedback(1, 100)]]]),
    });

    const apiErr = new ProgressApiError(422, 'validation_failed', 'content 必填');
    mockedCreate.mockRejectedValueOnce(apiErr);

    await expect(
      useFeedbacksStore.getState().create(100, { content: '' }),
    ).rejects.toBe(apiErr);

    const state = useFeedbacksStore.getState();
    expect(state.errorByProject.get(100)).toBe('content 必填');
    expect(state.byProject.get(100)).toHaveLength(1); // 没追加
  });

  it('在尚未 load 过的 project 上 create 也能工作（创建新桶）', async () => {
    const newFb = sampleFeedback(1, 999);
    mockedCreate.mockResolvedValueOnce(newFb);

    await useFeedbacksStore.getState().create(999, { content: 'first' });

    expect(useFeedbacksStore.getState().byProject.get(999)).toEqual([newFb]);
  });
});

// ============================================
// updateStatus
// ============================================
describe('feedbacksStore.updateStatus', () => {
  it('更新成功后替换 byProject 中对应行', async () => {
    const original = sampleFeedback(1, 100);
    useFeedbacksStore.setState({
      byProject: new Map([[100, [original, sampleFeedback(2, 100)]]]),
    });

    const updated = { ...original, status: 'done' as const };
    mockedUpdate.mockResolvedValueOnce(updated);

    await useFeedbacksStore.getState().updateStatus(1, 'done');

    const list = useFeedbacksStore.getState().byProject.get(100)!;
    expect(list[0].status).toBe('done');
    expect(list[1].status).toBe('pending'); // 其它行不动
  });

  it('对未缓存项目的反馈调 updateStatus 后会 lazy 加入桶', async () => {
    // store 完全空
    const fb = sampleFeedback(42, 777, { status: 'done' });
    mockedUpdate.mockResolvedValueOnce(fb);

    await useFeedbacksStore.getState().updateStatus(42, 'done');

    const list = useFeedbacksStore.getState().byProject.get(777);
    expect(list).toEqual([fb]);
  });
});

// ============================================
// selectors + clear
// ============================================
describe('feedbacksStore selectors and clear', () => {
  it('未加载的 project getByProject 返回空数组', () => {
    expect(useFeedbacksStore.getState().getByProject(404)).toEqual([]);
  });

  it('isLoading / getError 默认值', () => {
    expect(useFeedbacksStore.getState().isLoading(1)).toBe(false);
    expect(useFeedbacksStore.getState().getError(1)).toBeNull();
  });

  it('clear 清空所有桶', () => {
    useFeedbacksStore.setState({
      byProject: new Map([[1, [sampleFeedback(1, 1)]]]),
      loadingByProject: new Set([1]),
      errorByProject: new Map([[1, 'err']]),
    });

    useFeedbacksStore.getState().clear();

    const state = useFeedbacksStore.getState();
    expect(state.byProject.size).toBe(0);
    expect(state.loadingByProject.size).toBe(0);
    expect(state.errorByProject.size).toBe(0);
  });
});
