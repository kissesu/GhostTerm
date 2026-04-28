/**
 * @file TemplateSelector.test.tsx
 * @description TemplateSelector 组件测试：
 *   1. 渲染模板列表中的选项
 *   2. 切换 select 触发 setActiveTemplate
 * @author Atlas.oi
 * @date 2026-04-18
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Tauri invoke（TemplateStore 内部调用） ───
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// ─── Mock sidecarInvoke（TemplateStore 的 create 路径） ───
vi.mock('../toolsSidecarClient', () => ({
  sidecarInvoke: vi.fn(),
}));

import { useTemplateStore } from '../templates/TemplateStore';
import { useToolsStore } from '../toolsStore';
import { TemplateSelector } from '../templates/TemplateSelector';
import type { TemplateJson } from '../templates/TemplateStore';

// ─── 测试用模板 fixtures ───────────────────────
const tplA: TemplateJson = {
  schema_version: 2,
  id: '_builtin-gbt7714-v2',
  name: 'GB/T 7714 内置',
  source: { type: 'builtin' },
  updated_at: '2026-01-01T00:00:00.000Z',
  rules: {},
};

const tplB: TemplateJson = {
  schema_version: 2,
  id: 'user-apa',
  name: 'APA 用户模板',
  source: { type: 'manual' },
  updated_at: '2026-01-02T00:00:00.000Z',
  rules: {},
};

beforeEach(() => {
  // 重置 store 为已加载状态，mock load 以防止 useEffect 调用 invoke 引起 loading=true
  useTemplateStore.setState({
    templates: [tplA, tplB],
    loading: false,
    // load 是 no-op，避免 TemplateSelector mount 时把 loading 拉回 true
    load: vi.fn().mockResolvedValue(undefined),
  });
  useToolsStore.setState({ activeTemplateId: '_builtin-gbt7714-v2' });
  localStorage.clear();
});

describe('TemplateSelector', () => {
  it('渲染模板列表中的所有选项', () => {
    render(<TemplateSelector />);
    const select = screen.getByTestId('template-select') as HTMLSelectElement;
    // 两个模板各有一个 option
    expect(select.options).toHaveLength(2);
    expect(select.options[0].text).toBe('GB/T 7714 内置');
    expect(select.options[1].text).toBe('APA 用户模板');
  });

  it('切换选项触发 setActiveTemplate 并更新 store', () => {
    render(<TemplateSelector />);
    const select = screen.getByTestId('template-select') as HTMLSelectElement;

    // 切换到 user-apa
    fireEvent.change(select, { target: { value: 'user-apa' } });

    expect(useToolsStore.getState().activeTemplateId).toBe('user-apa');
  });
});
