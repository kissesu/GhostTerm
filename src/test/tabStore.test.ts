/**
 * @file tabStore.test.ts
 * @description tabStore 单元测试
 * @author Atlas.oi
 * @date 2026-04-17
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTabStore } from '../shared/stores/tabStore';

describe('tabStore', () => {
  beforeEach(() => {
    useTabStore.setState({ activeTab: 'project' });
  });

  it('默认激活 project tab', () => {
    expect(useTabStore.getState().activeTab).toBe('project');
  });

  it('setActive 切换 tab', () => {
    useTabStore.getState().setActive('tools');
    expect(useTabStore.getState().activeTab).toBe('tools');
    useTabStore.getState().setActive('progress');
    expect(useTabStore.getState().activeTab).toBe('progress');
  });

  it('不写 localStorage（无持久化）', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    useTabStore.getState().setActive('tools');
    expect(spy).not.toHaveBeenCalledWith(expect.stringContaining('tab'), expect.anything());
    spy.mockRestore();
  });
});
