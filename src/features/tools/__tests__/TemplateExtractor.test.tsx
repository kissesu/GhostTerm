/**
 * @file TemplateExtractor.test.tsx
 * @description TemplateExtractor 组件测试（5 case）
 *   1. mount 后调 extract_template sidecar 命令
 *   2. 提取成功后显示 11 条规则行（evidence 条数决定行数）
 *   3. 修改 enabled checkbox 反映到 draft state（行变为未勾选）
 *   4. 保存调 store.create + store.update（两个 mock 都被调）
 *   5. extract 失败显示错误信息
 * @author Atlas.oi
 * @date 2026-04-18
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Tauri invoke ───────────────────────
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// ─── Mock sidecarClient ───────────────────────
vi.mock('../toolsSidecarClient', () => ({
  sidecarInvoke: vi.fn(),
}));

import { sidecarInvoke } from '../toolsSidecarClient';
import { useTemplateStore } from '../templates/TemplateStore';
import { TemplateExtractor } from '../templates/TemplateExtractor';
import type { TemplateJson } from '../templates/TemplateStore';

// ─── 完整 11 条 evidence fixture（按 RULE_SCHEMAS key 顺序）───────
const ALL_RULE_IDS = [
  'font.body',
  'font.h1',
  'paragraph.indent',
  'citation.format',
  'figure.caption_pos',
  'table.caption_pos',
  'cjk_ascii_space',
  'chapter.new_page',
  'quote.style',
  'ai_pattern.check',
  'pagination',
];

// sidecar 返回的 rules（11 条）
const mockRules: Record<string, { enabled: boolean; value: unknown }> = {
  'font.body':          { enabled: true,  value: { family: '宋体', size_pt: 12 } },
  'font.h1':            { enabled: true,  value: { family: '黑体', size_pt: 16, bold: true } },
  'paragraph.indent':   { enabled: true,  value: { first_line_chars: 2 } },
  'citation.format':    { enabled: true,  value: { style: 'gbt7714', marker: 'superscript' } },
  'figure.caption_pos': { enabled: true,  value: 'below' },
  'table.caption_pos':  { enabled: true,  value: 'above' },
  'cjk_ascii_space':    { enabled: false, value: { allowed: false } },
  'chapter.new_page':   { enabled: true,  value: true },
  'quote.style':        { enabled: true,  value: 'cjk' },
  'ai_pattern.check':   { enabled: false, value: { ruleset: 'default' } },
  'pagination':         { enabled: true,  value: { front_matter: 'roman', body: 'arabic' } },
};

// sidecar 返回的 evidence（11 条）
const mockEvidence = ALL_RULE_IDS.map((id, i) => ({
  rule_id: id,
  source_xml: `<w:rPr data-rule="${id}"/>`,
  confidence: 0.9 - i * 0.05,
}));

// 完整 mock ExtractResult
const mockExtractResult = { rules: mockRules, evidence: mockEvidence };

// 内置模板（store.create 需要它）
const builtinTpl: TemplateJson = {
  schema_version: 1,
  id: '_builtin-gbt7714',
  name: 'GB/T 7714 内置',
  source: { type: 'builtin' },
  updated_at: '2026-01-01T00:00:00.000Z',
  rules: mockRules,
};

// ─────────────────────────────────────────────
// 辅助：重置 store 到干净状态
// ─────────────────────────────────────────────
beforeEach(() => {
  useTemplateStore.setState({
    templates: [builtinTpl],
    loading: false,
  });
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────
// 测试组
// ─────────────────────────────────────────────

describe('TemplateExtractor', () => {
  it('mount 后调 extract_template sidecar 命令', async () => {
    vi.mocked(sidecarInvoke).mockResolvedValueOnce(mockExtractResult);

    render(
      <TemplateExtractor
        isOpen
        docxPath="/tmp/thesis.docx"
        defaultName="thesis"
        onClose={vi.fn()}
      />,
    );

    // 加载 spinner 先出现
    expect(screen.getByTestId('extractor-loading')).toBeTruthy();

    // 等待 sidecarInvoke 被调
    await waitFor(() => {
      expect(sidecarInvoke).toHaveBeenCalledTimes(1);
    });

    // 验证调用参数：cmd=extract_template，file=docxPath
    expect(sidecarInvoke).toHaveBeenCalledWith({
      cmd: 'extract_template',
      file: '/tmp/thesis.docx',
    });
  });

  it('提取成功后显示 11 条规则行', async () => {
    vi.mocked(sidecarInvoke).mockResolvedValueOnce(mockExtractResult);

    render(
      <TemplateExtractor
        isOpen
        docxPath="/tmp/thesis.docx"
        defaultName="thesis"
        onClose={vi.fn()}
      />,
    );

    // 等待表格出现
    await waitFor(() => {
      expect(screen.getByTestId('extractor-table')).toBeTruthy();
    });

    // 11 条规则行各有对应 data-testid
    for (const ruleId of ALL_RULE_IDS) {
      expect(
        screen.getByTestId(`extractor-row-${ruleId}`),
        `行 ${ruleId} 应存在`,
      ).toBeTruthy();
    }
  });

  it('修改 enabled checkbox 反映到行的勾选状态', async () => {
    vi.mocked(sidecarInvoke).mockResolvedValueOnce(mockExtractResult);

    render(
      <TemplateExtractor
        isOpen
        docxPath="/tmp/thesis.docx"
        defaultName="thesis"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('extractor-table')).toBeTruthy();
    });

    // font.body 初始 enabled=true
    const checkbox = screen.getByTestId('enable-font.body') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    // 取消勾选
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
  });

  it('保存调 store.create + store.update', async () => {
    vi.mocked(sidecarInvoke).mockResolvedValueOnce(mockExtractResult);

    // mock store.create + store.update（store 内部调 Tauri invoke）
    const createMock = vi.fn().mockResolvedValue('new-id-123');
    const updateMock = vi.fn().mockResolvedValue(undefined);
    useTemplateStore.setState({
      templates: [builtinTpl],
      loading: false,
      create: createMock,
      update: updateMock,
    } as unknown as ReturnType<typeof useTemplateStore.getState>);

    const onSaved = vi.fn();
    const onClose = vi.fn();

    render(
      <TemplateExtractor
        isOpen
        docxPath="/tmp/thesis.docx"
        defaultName="thesis"
        onClose={onClose}
        onSaved={onSaved}
      />,
    );

    // 等表格加载完
    await waitFor(() => {
      expect(screen.getByTestId('extractor-table')).toBeTruthy();
    });

    // 点击保存
    const saveBtn = screen.getByTestId('extractor-save-btn');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      // create 和 update 都应被调用
      expect(createMock).toHaveBeenCalledWith('thesis');
      expect(updateMock).toHaveBeenCalledWith('new-id-123', expect.objectContaining({ rules: expect.any(Object) }));
    });

    // 回调触发
    expect(onSaved).toHaveBeenCalledWith('new-id-123');
    expect(onClose).toHaveBeenCalled();
  });

  it('extract 失败时显示错误信息', async () => {
    vi.mocked(sidecarInvoke).mockRejectedValueOnce(new Error('SIDECAR_UNAVAILABLE'));

    render(
      <TemplateExtractor
        isOpen
        docxPath="/tmp/bad.docx"
        defaultName="bad"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('extractor-error')).toBeTruthy();
    });

    // 错误信息应包含错误文本
    expect(screen.getByTestId('extractor-error').textContent).toContain('SIDECAR_UNAVAILABLE');
  });
});
