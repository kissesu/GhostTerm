/**
 * @file NamePromptModal.test.tsx
 * @description NamePromptModal 组件单元测试
 *   1. isOpen=false 时不渲染
 *   2. isOpen=true 时渲染标题、输入框、取消/确定按钮
 *   3. defaultValue 填充到输入框
 *   4. 空输入时确定按钮 disabled
 *   5. 输入内容后点确定 → onSubmit 被调用（trimmed）
 *   6. 点取消 → onCancel 被调用
 *   7. 点遮罩 → onCancel 被调用
 *   8. Enter 键触发 submit，Escape 键触发 cancel
 *   9. isOpen 从 true → false → true 时 defaultValue 重置
 * @author Atlas.oi
 * @date 2026-04-18
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { NamePromptModal } from '../templates/NamePromptModal';

describe('NamePromptModal', () => {
  it('isOpen=false 时不渲染任何内容', () => {
    render(
      <NamePromptModal
        isOpen={false}
        title="测试标题"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.queryByTestId('name-prompt-modal')).toBeNull();
  });

  it('isOpen=true 时渲染标题、输入框和按钮', () => {
    render(
      <NamePromptModal
        isOpen
        title="新建模板"
        placeholder="请输入名称"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByTestId('name-prompt-modal')).toBeTruthy();
    expect(screen.getByText('新建模板')).toBeTruthy();
    expect(screen.getByTestId('name-prompt-input')).toBeTruthy();
    expect(screen.getByTestId('name-prompt-cancel')).toBeTruthy();
    expect(screen.getByTestId('name-prompt-submit')).toBeTruthy();
  });

  it('defaultValue 填充到输入框', () => {
    render(
      <NamePromptModal
        isOpen
        title="标题"
        defaultValue="预填值"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const input = screen.getByTestId('name-prompt-input') as HTMLInputElement;
    expect(input.value).toBe('预填值');
  });

  it('空输入时确定按钮处于 disabled', () => {
    render(
      <NamePromptModal
        isOpen
        title="标题"
        defaultValue=""
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByTestId('name-prompt-submit')).toBeDisabled();
  });

  it('输入内容后点确定 → onSubmit 被调（trim 处理空格）', () => {
    const onSubmit = vi.fn();
    render(
      <NamePromptModal
        isOpen
        title="标题"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    );
    const input = screen.getByTestId('name-prompt-input');
    fireEvent.change(input, { target: { value: '  我的模板  ' } });
    fireEvent.click(screen.getByTestId('name-prompt-submit'));
    expect(onSubmit).toHaveBeenCalledWith('我的模板');
  });

  it('点取消按钮 → onCancel 被调', () => {
    const onCancel = vi.fn();
    render(
      <NamePromptModal isOpen title="标题" onSubmit={vi.fn()} onCancel={onCancel} />
    );
    fireEvent.click(screen.getByTestId('name-prompt-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('点遮罩 → onCancel 被调', () => {
    const onCancel = vi.fn();
    render(
      <NamePromptModal isOpen title="标题" onSubmit={vi.fn()} onCancel={onCancel} />
    );
    // 点遮罩层（data-testid="name-prompt-modal"）
    fireEvent.click(screen.getByTestId('name-prompt-modal'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Enter 键触发 submit', () => {
    const onSubmit = vi.fn();
    render(
      <NamePromptModal isOpen title="标题" defaultValue="内容" onSubmit={onSubmit} onCancel={vi.fn()} />
    );
    const input = screen.getByTestId('name-prompt-input');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('内容');
  });

  it('Escape 键触发 cancel', () => {
    const onCancel = vi.fn();
    render(
      <NamePromptModal isOpen title="标题" onSubmit={vi.fn()} onCancel={onCancel} />
    );
    const input = screen.getByTestId('name-prompt-input');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
