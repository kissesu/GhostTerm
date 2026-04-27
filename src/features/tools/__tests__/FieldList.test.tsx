/**
 * @file FieldList.test.tsx
 * @description FieldList 组件测试：渲染、定位回调、跳过回调、高亮、进度计数、属性行渲染、onAttrChange 回调
 * @author Atlas.oi
 * @date 2026-04-18
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { FieldList } from '../templates/FieldList';

describe('FieldList', () => {
  const mockFields = [
    { id: 'title_zh', label: '中文题目', status: 'done' as const, confidence: 0.9 },
    { id: 'abstract_zh_title', label: '摘要标题', status: 'empty' as const },
  ];

  // 所有测试必须传 onAttrChange，因为 FieldList Props 已要求该回调
  const defaultProps = {
    fields: mockFields,
    currentFieldId: 'abstract_zh_title' as string | null,
    onJump: vi.fn(),
    onSkip: vi.fn(),
    onAttrChange: vi.fn(),
  };

  it('renders all fields', () => {
    render(<FieldList {...defaultProps} />);
    expect(screen.getByText('中文题目')).toBeInTheDocument();
    expect(screen.getByText('摘要标题')).toBeInTheDocument();
  });

  it('clicking 定位 button calls onJump', () => {
    const onJump = vi.fn();
    render(<FieldList {...defaultProps} currentFieldId="title_zh" onJump={onJump} />);
    const jumpButtons = screen.getAllByRole('button', { name: /定位/ });
    fireEvent.click(jumpButtons[0]);
    expect(onJump).toHaveBeenCalledWith('title_zh');
  });

  it('clicking 跳过 button calls onSkip', () => {
    const onSkip = vi.fn();
    render(<FieldList {...defaultProps} currentFieldId="title_zh" onSkip={onSkip} />);
    const skipButtons = screen.getAllByRole('button', { name: /跳过/ });
    fireEvent.click(skipButtons[0]);
    expect(onSkip).toHaveBeenCalledWith('title_zh');
  });

  it('highlights current field', () => {
    const { container } = render(<FieldList {...defaultProps} currentFieldId="abstract_zh_title" />);
    const current = container.querySelector('[data-current="true"]');
    expect(current).toHaveTextContent('摘要标题');
  });

  it('shows progress counter', () => {
    render(<FieldList {...defaultProps} currentFieldId={null} />);
    // 1 done + 0 skipped = 1/2
    expect(screen.getByText(/1\s*\/\s*2/)).toBeInTheDocument();
  });

  // ─────────────────────────────────────────────
  // Task 2 新增：属性行渲染测试
  // ─────────────────────────────────────────────

  it('renders attr labels for title_zh applicable_attributes', () => {
    // title_zh 的 applicable_attributes: ['font.cjk','font.size_pt','font.bold','para.align','content.char_count_max']
    const fields = [
      {
        id: 'title_zh',
        label: '中文题目',
        status: 'done' as const,
        confidence: 0.9,
        value: { 'font.cjk': '宋体' },
      },
    ];
    render(
      <FieldList
        fields={fields}
        currentFieldId={null}
        onJump={vi.fn()}
        onSkip={vi.fn()}
        onAttrChange={vi.fn()}
      />
    );
    // 中文字体标签应出现
    expect(screen.getByText('中文字体')).toBeInTheDocument();
    // 字号标签应出现
    expect(screen.getByText('字号')).toBeInTheDocument();
    // 最多字数标签应出现（content.char_count_max）
    expect(screen.getByText('最多字数')).toBeInTheDocument();
  });

  it('shows captured marker for attrs present in value, uncaptured marker for missing attrs', () => {
    // 构造一个字段：只有 font.cjk 有值，font.size_pt 和 font.bold 没有
    const fields = [
      {
        id: 'title_zh',
        label: '中文题目',
        status: 'partial' as const,
        confidence: 0.7,
        value: { 'font.cjk': '宋体' },
      },
    ];
    render(
      <FieldList
        fields={fields}
        currentFieldId={null}
        onJump={vi.fn()}
        onSkip={vi.fn()}
        onAttrChange={vi.fn()}
      />
    );
    // font.cjk 已抓到 → 显示勾
    // 同一行有 "中文字体" 和 "✓"，通过 queryAllByText 断言至少有一个勾存在
    const checks = screen.queryAllByText('✓');
    expect(checks.length).toBeGreaterThan(0);

    // font.size_pt / font.bold 未抓到 → 显示"⨯ 未抓到"
    const uncaptured = screen.queryAllByText('⨯ 未抓到');
    expect(uncaptured.length).toBeGreaterThan(0);
  });

  // ─────────────────────────────────────────────
  // Task 5：mixed_script.punct_space_after 属性行渲染测试
  // ─────────────────────────────────────────────

  it('renders mixed_script.punct_space_after label and uncaptured marker when value is empty', () => {
    // 构造一个使用 mixed_script_global 字段的 FieldStatus，value 为空
    // applicable_attributes 会从 fieldDefs 中读取，包含 punct_space_after
    const fields = [
      {
        id: 'mixed_script_global',
        label: '数字/西文字体全局',
        status: 'empty' as const,
        // 无 value → punct_space_after 未抓到
      },
    ];
    render(
      <FieldList
        fields={fields}
        currentFieldId={null}
        onJump={vi.fn()}
        onSkip={vi.fn()}
        onAttrChange={vi.fn()}
      />
    );
    // 属性标签应出现
    expect(screen.getByText('英文标点后空一字符')).toBeInTheDocument();
    // 未抓到时显示"⨯ 未抓到"标记
    const uncaptured = screen.queryAllByText('⨯ 未抓到');
    expect(uncaptured.length).toBeGreaterThan(0);
  });

  // ─────────────────────────────────────────────
  // T3.1: 验证 chapter_title 渲染管线包含新增 attr 的编辑器
  // ─────────────────────────────────────────────

  it('T3.1: chapter_title 渲染管线包含 para.space_before_pt 和 para.space_after_pt 编辑器', () => {
    // chapter_title 的 applicable_attributes T3.1 后包含 para.space_before_pt / para.space_after_pt
    const fields = [
      {
        id: 'chapter_title',
        label: '一级章节标题',
        status: 'done' as const,
        confidence: 0.9,
        value: { 'para.space_before_pt': 12, 'para.space_after_pt': 6 },
      },
    ];
    render(
      <FieldList
        fields={fields}
        currentFieldId={null}
        onJump={vi.fn()}
        onSkip={vi.fn()}
        onAttrChange={vi.fn()}
      />
    );
    // attr-space-before-pt 对应 RuleValueEditorByAttr case 'para.space_before_pt'
    expect(screen.getByTestId('attr-space-before-pt')).toBeInTheDocument();
    expect(screen.getByTestId('attr-space-after-pt')).toBeInTheDocument();
  });

  it('T3.1: page_margin 渲染管线包含 page.print_mode 编辑器', () => {
    // page_margin.applicable_attributes T3.1 后包含 page.print_mode
    const fields = [
      {
        id: 'page_margin',
        label: '页边距',
        status: 'partial' as const,
        confidence: 0.7,
        value: { 'page.print_mode': 'single' },
      },
    ];
    render(
      <FieldList
        fields={fields}
        currentFieldId={null}
        onJump={vi.fn()}
        onSkip={vi.fn()}
        onAttrChange={vi.fn()}
      />
    );
    // attr-print-mode 对应 RuleValueEditorByAttr case 'page.print_mode'
    expect(screen.getByTestId('attr-print-mode')).toBeInTheDocument();
  });

  it('calls onAttrChange with correct args when editor value changes', () => {
    // 构造一个字段，只测试 font.cjk（CjkFontSelect，select 元素可 fireEvent.change）
    const fields = [
      {
        id: 'title_zh',
        label: '中文题目',
        status: 'done' as const,
        confidence: 0.9,
        value: { 'font.cjk': '宋体' },
      },
    ];
    const onAttrChange = vi.fn();
    render(
      <FieldList
        fields={fields}
        currentFieldId={null}
        onJump={vi.fn()}
        onSkip={vi.fn()}
        onAttrChange={onAttrChange}
      />
    );
    // attr-cjk-font 是 CjkFontSelect 对应的 data-testid
    const select = screen.getByTestId('attr-cjk-font');
    fireEvent.change(select, { target: { value: '黑体' } });
    // onAttrChange 应被精确调用一次，携带正确的 fieldId 和 attrKey
    expect(onAttrChange).toHaveBeenCalledTimes(1);
    expect(onAttrChange).toHaveBeenCalledWith('title_zh', 'font.cjk', '黑体');
  });
});
