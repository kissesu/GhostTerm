/**
 * @file RuleTemplateWorkspace.test.tsx
 * @description RuleTemplateWorkspace 整合测试（mock sidecar + docx-preview）
 * @author Atlas.oi
 * @date 2026-04-18
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { RuleTemplateWorkspace } from '../templates/RuleTemplateWorkspace';

// Mock sidecar client
vi.mock('../toolsSidecarClient', async () => {
  const actual = await vi.importActual<typeof import('../toolsSidecarClient')>('../toolsSidecarClient');
  return {
    ...actual,
    sidecarInvoke: vi.fn(),
  };
});

// Mock docx-preview，避免真实 docx 渲染
vi.mock('docx-preview', () => ({
  renderAsync: vi.fn(async (_data: unknown, container: HTMLElement) => {
    container.innerHTML = '<div><p class="docx-paragraph">段 0</p><p class="docx-paragraph">段 1</p></div>';
  }),
}));

// mock @tauri-apps/api/core 的 invoke，仅替换 invoke 函数（保留其他导出）
// DocxPreview 内部用 invoke 读取文件字节，返回 base64 占位串即可
vi.mock('@tauri-apps/api/core', async () => {
  const actual = await vi.importActual<typeof import('@tauri-apps/api/core')>('@tauri-apps/api/core');
  return {
    ...actual,
    invoke: vi.fn(async () => 'AAAA'),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RuleTemplateWorkspace', () => {
  it('挂载时自动调用 extract_all', async () => {
    const { sidecarInvoke } = await import('../toolsSidecarClient');
    vi.mocked(sidecarInvoke).mockResolvedValueOnce({
      rules: {
        title_zh: { enabled: true, value: { 'font.cjk': '黑体', 'font.size_pt': 16 } },
      },
      evidence: [{ field_id: 'title_zh', source_para_idx: 0, source_text: 'XX', confidence: 0.9 }],
      unmatched_paragraphs: [],
    });

    render(<RuleTemplateWorkspace docxPath="/tmp/t.docx" onCancel={vi.fn()} onSave={vi.fn()} />);
    await waitFor(() => {
      expect(sidecarInvoke).toHaveBeenCalledWith(expect.objectContaining({ cmd: 'extract_all' }));
    });
  });

  it('渲染模板名称输入框、取消和保存按钮', async () => {
    const { sidecarInvoke } = await import('../toolsSidecarClient');
    vi.mocked(sidecarInvoke).mockResolvedValueOnce({ rules: {}, evidence: [], unmatched_paragraphs: [] } as any);
    const { getByPlaceholderText, getByText } = render(
      <RuleTemplateWorkspace docxPath="/tmp/t.docx" onCancel={vi.fn()} onSave={vi.fn()} />
    );
    expect(getByPlaceholderText('模板名称')).toBeInTheDocument();
    // 用 exact 匹配按钮文本，避免和提示文字的子串冲突
    expect(getByText('取消')).toBeInTheDocument();
    expect(getByText('保存为模板')).toBeInTheDocument();
  });
});
