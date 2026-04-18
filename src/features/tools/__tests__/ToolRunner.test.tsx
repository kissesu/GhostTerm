/**
 * @file ToolRunner.test.tsx
 * @description ToolRunner 组件测试：
 *   - 验证 activeToolId='thesis-format' 时 detect 只传该工具的 4 条规则
 *   - 验证无 activeTemplate 时 detect 不调用 sidecarInvoke 而设错误
 *   - 验证 activeToolId 变化时清空文件/issues
 * @author Atlas.oi
 * @date 2026-04-18
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----------------------------------------------------------------
// Mock：必须在 import 组件之前建立
// ----------------------------------------------------------------
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue('/test/sample.docx'),
}));

vi.mock('../toolsSidecarClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../toolsSidecarClient')>();
  return {
    ...actual,
    sidecarInvoke: vi.fn(),
    sidecarRestart: vi.fn(),
  };
});

// mock useToolsStore：默认 activeToolId='thesis-format', activeTemplateId='test-tpl'
vi.mock('../toolsStore', () => ({
  useToolsStore: vi.fn(),
}));

// mock useTemplateStore：默认返回包含测试模板的列表
vi.mock('../templates/TemplateStore', () => ({
  useTemplateStore: vi.fn(),
}));

import { sidecarInvoke } from '../toolsSidecarClient';
import { useToolsStore } from '../toolsStore';
import { useTemplateStore } from '../templates/TemplateStore';
import { ToolRunner } from '../ToolRunner';
import type { TemplateJson } from '../templates/TemplateStore';

// ----------------------------------------------------------------
// 测试用模板（涵盖多个规则类别）
// ----------------------------------------------------------------
const MOCK_TEMPLATE: TemplateJson = {
  schema_version: 1,
  id: 'test-tpl',
  name: '测试模板',
  source: { type: 'manual' },
  updated_at: '2026-04-18T00:00:00Z',
  rules: {
    'font.body': { enabled: true, value: { family: 'SimSun', size: 12 } },
    'font.h1': { enabled: true, value: { family: 'SimHei', size: 16 } },
    'paragraph.indent': { enabled: true, value: { chars: 2 } },
    'chapter.new_page': { enabled: true, value: true },
    // 额外规则，不属于 thesis-format
    'cjk_ascii_space': { enabled: true, value: { allowed: false } },
    'citation.format': { enabled: true, value: null },
  },
};

// 基础 issue 工厂，满足 snippet/context 校验
function makeIssue(ruleId: string) {
  return {
    rule_id: ruleId,
    loc: { para: 0, run: 0 },
    message: '格式不符',
    current: null,
    expected: null,
    fix_available: false,
    snippet: '示例文本',
    context: '段落预览前30字',
    issue_id: `issue-${ruleId}`,
    evidence_xml: null,
  };
}

// 默认 store mock 辅助函数
function setupStoreMocks(overrides: {
  activeToolId?: string | null;
  activeTemplateId?: string;
  templates?: TemplateJson[];
} = {}) {
  const activeToolId = overrides.activeToolId !== undefined ? overrides.activeToolId : 'thesis-format';
  const activeTemplateId = overrides.activeTemplateId ?? 'test-tpl';
  const templates = overrides.templates ?? [MOCK_TEMPLATE];

  vi.mocked(useToolsStore).mockReturnValue({
    activeToolId,
    activeTemplateId,
    setActiveTool: vi.fn(),
  } as ReturnType<typeof useToolsStore>);

  vi.mocked(useTemplateStore).mockReturnValue(templates);
  // getState 供 useEffect 内的 load 调用
  (useTemplateStore as unknown as { getState: () => { load: () => Promise<void> } }).getState = vi.fn().mockReturnValue({
    load: vi.fn().mockResolvedValue(undefined),
  });
}

describe('ToolRunner', () => {
  beforeEach(() => {
    vi.mocked(sidecarInvoke).mockReset();
    setupStoreMocks();
  });

  it('activeToolId=thesis-format 时 detect 只传 4 条规则', async () => {
    // sidecarInvoke detect 返回空 issues
    vi.mocked(sidecarInvoke).mockResolvedValue({
      issues: [
        makeIssue('font.body'),
        makeIssue('font.h1'),
      ],
    });

    render(<ToolRunner />);

    // 点击"选择 DOCX 文件"
    const pickBtn = screen.getByText('选择 DOCX 文件');
    fireEvent.click(pickBtn);

    // 等待文件路径显示
    await waitFor(() => {
      expect(screen.getByText('/test/sample.docx')).toBeTruthy();
    });

    // 点击"运行检测"
    const detectBtn = screen.getByText('运行检测');
    fireEvent.click(detectBtn);

    await waitFor(() => {
      expect(vi.mocked(sidecarInvoke)).toHaveBeenCalledTimes(1);
    });

    const callArg = vi.mocked(sidecarInvoke).mock.calls[0][0] as { cmd: string; template: { rules: Record<string, unknown> } };
    expect(callArg.cmd).toBe('detect');

    // thesis-format 的 ruleIds = ['font.body', 'font.h1', 'paragraph.indent', 'chapter.new_page']
    // 过滤后的 rules 应只包含这 4 条（cjk_ascii_space、citation.format 应被排除）
    const ruleKeys = Object.keys(callArg.template.rules);
    expect(ruleKeys).toHaveLength(4);
    expect(ruleKeys).toContain('font.body');
    expect(ruleKeys).toContain('font.h1');
    expect(ruleKeys).toContain('paragraph.indent');
    expect(ruleKeys).toContain('chapter.new_page');
    expect(ruleKeys).not.toContain('cjk_ascii_space');
    expect(ruleKeys).not.toContain('citation.format');

    // 检测完成后应显示汇总（2 处违规：font.body + font.h1）
    await waitFor(() => {
      const summary = screen.getByTestId('detect-summary');
      expect(summary.textContent).toContain('4 条规则');
      expect(summary.textContent).toContain('2 处违规');
    });
  });

  it('无 activeTemplate 时点检测显示错误提示，不调用 sidecarInvoke', async () => {
    // templates 为空，找不到 activeTemplateId 对应的模板
    setupStoreMocks({ templates: [] });

    render(<ToolRunner />);

    // 选择文件
    fireEvent.click(screen.getByText('选择 DOCX 文件'));
    await waitFor(() => {
      expect(screen.getByText('/test/sample.docx')).toBeTruthy();
    });

    // 检测按钮应处于 disabled 状态（无 activeTemplate）
    const detectBtn = screen.getByText('运行检测');
    expect(detectBtn).toBeDisabled();

    // sidecarInvoke 不应被调用
    expect(vi.mocked(sidecarInvoke)).not.toHaveBeenCalled();
  });

  it('activeToolId=null 时不过滤规则，传完整 template，完成后显示规则数汇总', async () => {
    setupStoreMocks({ activeToolId: null });

    vi.mocked(sidecarInvoke).mockResolvedValue({ issues: [] });

    render(<ToolRunner />);

    fireEvent.click(screen.getByText('选择 DOCX 文件'));
    await waitFor(() => expect(screen.getByText('/test/sample.docx')).toBeTruthy());

    fireEvent.click(screen.getByText('运行检测'));
    await waitFor(() => expect(vi.mocked(sidecarInvoke)).toHaveBeenCalledTimes(1));

    const callArg = vi.mocked(sidecarInvoke).mock.calls[0][0] as { cmd: string; template: { rules: Record<string, unknown> } };
    // activeToolId=null 时返回完整 template（6 条规则）
    const ruleKeys = Object.keys(callArg.template.rules);
    expect(ruleKeys).toHaveLength(6);

    // 无违规时显示"未发现违规"汇总
    await waitFor(() => {
      const summary = screen.getByTestId('detect-summary');
      expect(summary.textContent).toContain('未发现违规');
    });
  });
});
