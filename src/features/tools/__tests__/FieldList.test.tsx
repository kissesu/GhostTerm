/**
 * @file FieldList.test.tsx
 * @description FieldList 组件测试：渲染、定位回调、跳过回调、高亮、进度计数
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

  it('renders all fields', () => {
    render(
      <FieldList fields={mockFields} currentFieldId="abstract_zh_title" onJump={vi.fn()} onSkip={vi.fn()} />
    );
    expect(screen.getByText('中文题目')).toBeInTheDocument();
    expect(screen.getByText('摘要标题')).toBeInTheDocument();
  });

  it('clicking 定位 button calls onJump', () => {
    const onJump = vi.fn();
    render(
      <FieldList fields={mockFields} currentFieldId="title_zh" onJump={onJump} onSkip={vi.fn()} />
    );
    const jumpButtons = screen.getAllByRole('button', { name: /定位/ });
    fireEvent.click(jumpButtons[0]);
    expect(onJump).toHaveBeenCalledWith('title_zh');
  });

  it('clicking 跳过 button calls onSkip', () => {
    const onSkip = vi.fn();
    render(
      <FieldList fields={mockFields} currentFieldId="title_zh" onJump={vi.fn()} onSkip={onSkip} />
    );
    const skipButtons = screen.getAllByRole('button', { name: /跳过/ });
    fireEvent.click(skipButtons[0]);
    expect(onSkip).toHaveBeenCalledWith('title_zh');
  });

  it('highlights current field', () => {
    const { container } = render(
      <FieldList fields={mockFields} currentFieldId="abstract_zh_title" onJump={vi.fn()} onSkip={vi.fn()} />
    );
    const current = container.querySelector('[data-current="true"]');
    expect(current).toHaveTextContent('摘要标题');
  });

  it('shows progress counter', () => {
    render(
      <FieldList fields={mockFields} currentFieldId={null} onJump={vi.fn()} onSkip={vi.fn()} />
    );
    // 1 done + 0 skipped = 1/2
    expect(screen.getByText(/1\s*\/\s*2/)).toBeInTheDocument();
  });
});
