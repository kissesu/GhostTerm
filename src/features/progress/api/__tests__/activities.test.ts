/**
 * @file activities.test.ts
 * @description ActivitySchema discriminated union + getActivities envelope 解析行为契约。
 *
 *              测试覆盖：
 *                1. ActivitySchema.parse 正确分支到 feedback payload
 *                2. ActivitySchema.parse 拒绝未知 kind（白名单 7 种）
 *                3. getActivities 解析 ActivityListResponse 顶层 envelope（含 nextCursor）
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ActivitySchema, getActivities } from '../activities';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ActivitySchema', () => {
  it('parses feedback activity payload', () => {
    const raw = {
      id: 'feedback:1',
      sourceId: 1,
      projectId: 10,
      kind: 'feedback',
      occurredAt: '2026-05-01T12:00:00Z',
      actorId: 5,
      actorName: 'Alice',
      actorRoleName: '客服',
      payload: { content: 'hi', source: 'wechat', status: 'pending' },
    };
    const parsed = ActivitySchema.parse(raw);
    expect(parsed.kind).toBe('feedback');
    if (parsed.kind === 'feedback') {
      expect(parsed.payload.content).toBe('hi');
      expect(parsed.payload.source).toBe('wechat');
    }
  });

  it('rejects unknown kind value', () => {
    const raw = {
      id: 'x',
      sourceId: 1,
      projectId: 1,
      kind: 'unknown',
      occurredAt: '2026-05-01T00:00:00Z',
      actorId: 1,
      payload: {},
    };
    expect(() => ActivitySchema.parse(raw)).toThrow();
  });
});

describe('getActivities', () => {
  it('parses ActivityListResponse with data + nextCursor', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            id: 'project_created:10',
            sourceId: 10,
            projectId: 10,
            kind: 'project_created',
            occurredAt: '2026-05-01T11:00:00Z',
            actorId: 1,
            actorName: 'Admin',
            actorRoleName: 'admin',
            payload: {
              name: 'P',
              status: 'dealing',
              priority: 'normal',
              deadline: '2026-06-01T00:00:00Z',
              originalQuote: '1000.00',
            },
          },
        ],
        nextCursor: null,
      }),
    });
    vi.stubGlobal('fetch', fakeFetch);

    const res = await getActivities(10);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].kind).toBe('project_created');
    if (res.items[0].kind === 'project_created') {
      expect(res.items[0].payload.name).toBe('P');
    }
    expect(res.nextCursor).toBeNull();
    // 顺便验证 cursor 默认请求带 limit 但不带 before
    const calledUrl = fakeFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('limit=50');
    expect(calledUrl).not.toContain('before=');
  });
});
