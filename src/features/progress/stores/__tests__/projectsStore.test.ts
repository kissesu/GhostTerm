/**
 * @file projectsStore.test.ts
 * @description projectsStore 行为契约
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../api/projects', () => ({
  listProjects: vi.fn(),
  getProject: vi.fn(),
  triggerProjectEvent: vi.fn(),
}));

import { useProjectsStore } from '../projectsStore';
import { listProjects, getProject, triggerProjectEvent } from '../../api/projects';

beforeEach(() => {
  useProjectsStore.getState().clear();
  vi.resetAllMocks();
});

describe('projectsStore', () => {
  it('loadAll 写入 Map', async () => {
    vi.mocked(listProjects).mockResolvedValue([
      { id: 1, status: 'developing' } as any,
      { id: 2, status: 'quoting' } as any,
    ]);
    await useProjectsStore.getState().loadAll();
    const m = useProjectsStore.getState().projects;
    expect(m.size).toBe(2);
    expect(m.get(1)?.status).toBe('developing');
  });

  it('triggerEvent 后更新对应项目', async () => {
    useProjectsStore.setState({
      projects: new Map([[1, { id: 1, status: 'dealing' } as any]]),
    });
    vi.mocked(triggerProjectEvent).mockResolvedValue({ id: 1, status: 'quoting' } as any);
    await useProjectsStore.getState().triggerEvent(1, { event: 'E1', remark: 'x', newHolderUserId: null });
    expect(useProjectsStore.getState().projects.get(1)?.status).toBe('quoting');
  });

  it('loadAll 失败后 loadError 设值且 loading=false', async () => {
    vi.mocked(listProjects).mockRejectedValue(new Error('network error'));
    await useProjectsStore.getState().loadAll();
    const s = useProjectsStore.getState();
    expect(s.loadError).toBe('network error');
    expect(s.loading).toBe(false);
  });

  it('并发 loadAll 旧响应被新 seq 拒绝', async () => {
    // 第一次 loadAll 用延迟 promise
    let resolveFirst!: (v: any[]) => void;
    const firstPromise = new Promise<any[]>((res) => { resolveFirst = res; });
    vi.mocked(listProjects)
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce([{ id: 2, status: 'quoting' } as any]);

    // 同时触发两个 loadAll，第二个先 resolve
    const p1 = useProjectsStore.getState().loadAll();
    const p2 = useProjectsStore.getState().loadAll();
    await p2; // 第二个已经完成

    // 现在让第一个 resolve（旧结果）
    resolveFirst([{ id: 1, status: 'dealing' } as any]);
    await p1;

    // 第一个被 seq guard 拒绝，map 应保留第二个的结果
    const m = useProjectsStore.getState().projects;
    expect(m.size).toBe(1);
    expect(m.get(2)?.status).toBe('quoting');
    expect(m.has(1)).toBe(false);
  });

  it('triggerEvent 失败后 triggerErrorByProject 有值且原 Map 不变', async () => {
    const original = { id: 1, status: 'dealing' } as any;
    useProjectsStore.setState({
      projects: new Map([[1, original]]),
    });
    vi.mocked(triggerProjectEvent).mockRejectedValue(new Error('forbidden'));

    await expect(
      useProjectsStore.getState().triggerEvent(1, { event: 'E1', remark: '', newHolderUserId: null })
    ).rejects.toThrow('forbidden');

    const s = useProjectsStore.getState();
    expect(s.triggerErrorByProject.get(1)).toBe('forbidden');
    // 原 map 仍保留旧状态，没被覆盖
    expect(s.projects.get(1)?.status).toBe('dealing');
  });

  it('clearTriggerError 清掉对应项目的错误', async () => {
    useProjectsStore.setState({
      triggerErrorByProject: new Map([[1, 'some error']]),
    });
    useProjectsStore.getState().clearTriggerError(1);
    expect(useProjectsStore.getState().triggerErrorByProject.has(1)).toBe(false);
  });

  it('loadOne 更新单个项目', async () => {
    useProjectsStore.setState({
      projects: new Map([[1, { id: 1, status: 'dealing' } as any]]),
    });
    vi.mocked(getProject).mockResolvedValue({ id: 1, status: 'quoting' } as any);
    await useProjectsStore.getState().loadOne(1);
    expect(useProjectsStore.getState().projects.get(1)?.status).toBe('quoting');
  });
});
