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

// Mock DocxPreview：用简单按钮代替真实 docx 渲染，
// 使测试可以直接触发 onSelectionClick 而不依赖 docx-preview 异步 DOM 操作
// SelectionClick 是 TypeScript interface（纯类型），无需 importActual
vi.mock('../templates/DocxPreview', () => {
  return {
    DocxPreview: ({
      onSelectionClick,
    }: {
      onSelectionClick?: (sel: import('../templates/DocxPreview').SelectionClick) => void;
    }) => (
      <div data-testid="docx-preview-mock">
        <button
          data-testid="click-para-0"
          onClick={() =>
            onSelectionClick?.({ paraIdx: 0, text: '这是第一段文字', shiftKey: false })
          }
        >
          点击段落 0
        </button>
        <button
          data-testid="shift-click-sent-0-0"
          onClick={() =>
            onSelectionClick?.({
              paraIdx: 0,
              sentenceIdx: '0.0',
              text: '第一句。',
              shiftKey: true,
            })
          }
        >
          shift 点击句子 0.0
        </button>
        <button
          data-testid="shift-click-sent-0-1"
          onClick={() =>
            onSelectionClick?.({
              paraIdx: 0,
              sentenceIdx: '0.1',
              text: '第二句！',
              shiftKey: true,
            })
          }
        >
          shift 点击句子 0.1
        </button>
      </div>
    ),
  };
});

// mock @tauri-apps/api/core 的 invoke
vi.mock('@tauri-apps/api/core', async () => {
  const actual = await vi.importActual<typeof import('@tauri-apps/api/core')>('@tauri-apps/api/core');
  return {
    ...actual,
    invoke: vi.fn(async () => 'AAAA'),
  };
});

// mock docx-preview（保留以防其他代码路径引入）
vi.mock('docx-preview', () => ({
  renderAsync: vi.fn(async (_data: unknown, container: HTMLElement) => {
    container.innerHTML = '<div><p class="docx-paragraph">段 0</p><p class="docx-paragraph">段 1</p></div>';
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

/** 构建 extract_all 的默认 mock 返回值（空规则，覆盖 32 字段均 empty） */
function mockExtractAll() {
  return {
    rules: {},
    evidence: [],
    unmatched_paragraphs: [],
  };
}

/** 构建 extract_from_selection 的 mock 返回值 */
function mockExtractFromSelection(fieldId = 'title_zh') {
  return {
    field_id: fieldId,
    value: { 'font.cjk': '黑体', 'font.size_pt': 16 },
    confidence: 0.9,
    evidence: { source_text: '示例文本', matched_patterns: ['font.cjk', 'font.size_pt'] },
  };
}

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
    vi.mocked(sidecarInvoke).mockResolvedValueOnce(mockExtractAll() as any);
    const { getByPlaceholderText, getByText } = render(
      <RuleTemplateWorkspace docxPath="/tmp/t.docx" onCancel={vi.fn()} onSave={vi.fn()} />
    );
    expect(getByPlaceholderText('模板名称')).toBeInTheDocument();
    expect(getByText('取消')).toBeInTheDocument();
    expect(getByText('保存为模板')).toBeInTheDocument();
  });

  // ─────────────────────────────────────────────
  // handleAttrChange 行为测试
  // ─────────────────────────────────────────────
  it('skipped 字段在属性行被编辑后状态变为 done 且 confidence=1.0', async () => {
    const { sidecarInvoke } = await import('../toolsSidecarClient');
    vi.mocked(sidecarInvoke).mockResolvedValueOnce(mockExtractAll() as any);

    const { container } = render(
      <RuleTemplateWorkspace docxPath="/tmp/t.docx" onCancel={vi.fn()} onSave={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText('中文题目')).toBeInTheDocument();
    });

    const titleCard = Array.from(container.querySelectorAll<HTMLLIElement>('li[data-current]'))
      .find((el) => el.textContent?.includes('中文题目'));
    expect(titleCard).toBeTruthy();

    const skipBtn = within(titleCard!).getByRole('button', { name: /跳过/ });
    fireEvent.click(skipBtn);

    const cjkSelects = screen.getAllByTestId('attr-cjk-font');
    fireEvent.change(cjkSelects[0], { target: { value: '黑体' } });

    await waitFor(() => {
      const updatedCard = Array.from(container.querySelectorAll<HTMLLIElement>('li[data-current]'))
        .find((el) => el.textContent?.includes('中文题目'));
      expect(updatedCard?.textContent).toContain('(1.00)');
    });
  });

  // ─────────────────────────────────────────────
  // Task 4：非 shift 单击立即调 extract_from_selection
  // ─────────────────────────────────────────────
  it('非 shift 单击立即调 extract_from_selection，带 selected_text', async () => {
    const { sidecarInvoke } = await import('../toolsSidecarClient');
    // 第一次调用：extract_all
    vi.mocked(sidecarInvoke).mockResolvedValueOnce(mockExtractAll() as any);
    // 第二次调用：extract_from_selection
    vi.mocked(sidecarInvoke).mockResolvedValueOnce(mockExtractFromSelection('title_zh') as any);

    render(<RuleTemplateWorkspace docxPath="/tmp/t.docx" onCancel={vi.fn()} onSave={vi.fn()} />);

    // 等 extract_all 完成，字段列表渲染出来
    await waitFor(() => {
      expect(screen.getByText('中文题目')).toBeInTheDocument();
    });

    // 点击 DocxPreview mock 中的"点击段落 0"按钮（shiftKey=false）
    fireEvent.click(screen.getByTestId('click-para-0'));

    await waitFor(() => {
      // 第二次调用应为 extract_from_selection
      expect(sidecarInvoke).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: 'extract_from_selection',
          para_indices: [0],
          selected_text: '这是第一段文字',
        }),
      );
    });

    // 验证只调用了两次（extract_all + extract_from_selection 各一次）
    expect(sidecarInvoke).toHaveBeenCalledTimes(2);
  });

  // ─────────────────────────────────────────────
  // Task 4：shift 点击积累，松开 Shift 触发单次 invoke
  // ─────────────────────────────────────────────
  it('shift 点击两句积累，松开 Shift 触发单次 invoke 合并 selected_text', async () => {
    const { sidecarInvoke } = await import('../toolsSidecarClient');
    vi.mocked(sidecarInvoke).mockResolvedValueOnce(mockExtractAll() as any);
    vi.mocked(sidecarInvoke).mockResolvedValueOnce(mockExtractFromSelection('title_zh') as any);

    render(<RuleTemplateWorkspace docxPath="/tmp/t.docx" onCancel={vi.fn()} onSave={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('中文题目')).toBeInTheDocument();
    });

    // shift 点击第一句
    fireEvent.click(screen.getByTestId('shift-click-sent-0-0'));
    // shift 点击第二句
    fireEvent.click(screen.getByTestId('shift-click-sent-0-1'));

    // 此时 sidecar 应该只被调用一次（extract_all），没有触发 extract_from_selection
    expect(sidecarInvoke).toHaveBeenCalledTimes(1);

    // 模拟 Shift 松开（window keyup）
    fireEvent(window, new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));

    await waitFor(() => {
      // flush 后应触发第二次调用：extract_from_selection，合并文本用空格连接
      expect(sidecarInvoke).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: 'extract_from_selection',
          para_indices: [0],
          selected_text: '第一句。 第二句！',
        }),
      );
    });

    expect(sidecarInvoke).toHaveBeenCalledTimes(2);
  });
});
