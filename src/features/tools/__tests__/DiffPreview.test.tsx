/**
 * @file DiffPreview.test.tsx
 * @description DiffPreview 组件测试：diff 行着色、回调、busy 状态
 * @author Atlas.oi
 * @date 2026-04-18
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DiffPreview } from '../DiffPreview';

const DIFF_SAMPLE = '- 过 s\n+ 过s\n  context line';

describe('DiffPreview', () => {
  it('将 - 开头的行标记为 remove 类型', () => {
    render(
      <DiffPreview
        diff={DIFF_SAMPLE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        busy={false}
      />
    );
    // 找到以 "- " 开头的行 span
    const removeLine = screen.getByText('- 过 s');
    expect(removeLine).toHaveAttribute('data-line-type', 'remove');
  });

  it('将 + 开头的行标记为 add 类型', () => {
    render(
      <DiffPreview
        diff={DIFF_SAMPLE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        busy={false}
      />
    );
    const addLine = screen.getByText('+ 过s');
    expect(addLine).toHaveAttribute('data-line-type', 'add');
  });

  it('点击"确认修复"触发 onConfirm', () => {
    const onConfirm = vi.fn();
    render(
      <DiffPreview
        diff={DIFF_SAMPLE}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        busy={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '确认修复' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('点击"取消"触发 onCancel', () => {
    const onCancel = vi.fn();
    render(
      <DiffPreview
        diff={DIFF_SAMPLE}
        onConfirm={vi.fn()}
        onCancel={onCancel}
        busy={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('busy=true 时两个按钮均 disabled', () => {
    render(
      <DiffPreview
        diff={DIFF_SAMPLE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        busy={true}
      />
    );
    expect(screen.getByRole('button', { name: '确认修复' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
  });
});
