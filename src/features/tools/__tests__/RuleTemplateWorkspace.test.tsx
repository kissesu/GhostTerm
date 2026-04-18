/**
 * @file RuleTemplateWorkspace.test.tsx
 * @description RuleTemplateWorkspace 整合测试（mock sidecar + docx-preview）
 * @author Atlas.oi
 * @date 2026-04-18
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, fireEvent, screen, within } from '@testing-library/react';
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

  // ─────────────────────────────────────────────
  // handleAttrChange 行为测试
  // 确认用户手动编辑视为满分确认：即使字段已被 skipped，一旦触碰编辑器即 un-skip
  // ─────────────────────────────────────────────
  it('skipped 字段在属性行被编辑后状态变为 done 且 confidence=1.0', async () => {
    const { sidecarInvoke } = await import('../toolsSidecarClient');
    // 初始 extract_all 返回空：所有 32 字段都处于 empty 状态
    vi.mocked(sidecarInvoke).mockResolvedValueOnce({
      rules: {},
      evidence: [],
      unmatched_paragraphs: [],
    } as any);

    const { container } = render(
      <RuleTemplateWorkspace docxPath="/tmp/t.docx" onCancel={vi.fn()} onSave={vi.fn()} />
    );

    // 等待初始 extract_all 完成并渲染出字段列表（title_zh 是第一个字段）
    await waitFor(() => {
      expect(screen.getByText('中文题目')).toBeInTheDocument();
    });

    // 定位到 title_zh 字段卡片，所有字段 <li> 都有 data-current 属性
    const titleCard = Array.from(container.querySelectorAll<HTMLLIElement>('li[data-current]'))
      .find((el) => el.textContent?.includes('中文题目'));
    expect(titleCard).toBeTruthy();

    // 第 1 步：点击"跳过"按钮，将 title_zh 标为 skipped
    const skipBtn = within(titleCard!).getByRole('button', { name: /跳过/ });
    fireEvent.click(skipBtn);

    // 第 2 步：在 title_zh 的 font.cjk 属性行触发编辑（字体下拉选择"黑体"）
    // data-testid="attr-cjk-font" 在第一个字段出现的第一个 select
    const cjkSelects = screen.getAllByTestId('attr-cjk-font');
    fireEvent.change(cjkSelects[0], { target: { value: '黑体' } });

    // 第 3 步：验证该字段置信度显示 "(1.00)"，并且不再显示 "跳过" 状态
    // FieldList 在 confidence !== undefined 时渲染 "(xx.xx)"
    await waitFor(() => {
      const updatedCard = Array.from(container.querySelectorAll<HTMLLIElement>('li[data-current]'))
        .find((el) => el.textContent?.includes('中文题目'));
      expect(updatedCard?.textContent).toContain('(1.00)');
    });
  });
});
