/**
 * @file toolsSidecarClient.test.ts
 * @description sidecar client 请求/响应 + 错误路径测试
 * @author Atlas.oi
 * @date 2026-04-17
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
// setup.ts 中已全局 mock @tauri-apps/api/core，此处直接导入使用
import { invoke } from '@tauri-apps/api/core';
import { sidecarInvoke } from '../toolsSidecarClient';

describe('toolsSidecarClient', () => {
  // 用显式 block body 避免 mockReset() 返回值被 vitest 3.x 误注册为 cleanup hook
  beforeEach(() => { vi.mocked(invoke).mockReset(); });

  it('成功响应返回 result', async () => {
    vi.mocked(invoke).mockResolvedValue({ id: 'r1', ok: true, result: 'pong' });
    const res = await sidecarInvoke({ cmd: 'ping' });
    expect(res).toBe('pong');
  });

  it('ok:false 抛 SidecarError（含 code + 完整 error 字符串）', async () => {
    vi.mocked(invoke).mockResolvedValue({
      id: 'r1', ok: false,
      error: 'Traceback...\nRuleError: rule cjk_ascii_space raised',
      code: 'RULE_ERROR',
    });
    await expect(sidecarInvoke({ cmd: 'detect', file: 'x', template: {} as any }))
      .rejects.toMatchObject({
        code: 'RULE_ERROR',
        fullError: expect.stringContaining('Traceback'),
      });
  });

  it('invoke 本身抛异常（Rust 端错误）→ 也包装成 SidecarError', async () => {
    vi.mocked(invoke).mockRejectedValue('sidecar binary not found');
    await expect(sidecarInvoke({ cmd: 'ping' }))
      .rejects.toMatchObject({
        code: 'SIDECAR_UNAVAILABLE',
      });
  });

  it('自动分配 id', async () => {
    vi.mocked(invoke).mockImplementation(async (_cmd, args: any) => ({
      id: args.payload.id,
      ok: true,
      result: args.payload.id,  // 回显 id
    }));
    const r1 = await sidecarInvoke({ cmd: 'ping' });
    const r2 = await sidecarInvoke({ cmd: 'ping' });
    expect(r1).not.toBe(r2);  // 两次 id 不同
  });
});
