/**
 * @file ConflictDialog.test.tsx
 * @description ConflictDialog 组件单元测试 - 验证三个操作按钮渲染和点击回调触发
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConflictDialog from '../ConflictDialog';

describe('ConflictDialog', () => {
  const defaultProps = {
    path: '/proj/src/main.ts',
    onKeep: vi.fn(),
    onLoad: vi.fn(),
    onDiff: vi.fn(),
  };

  it('渲染时应显示文件名', () => {
    render(<ConflictDialog {...defaultProps} />);
    // 文件名应出现在对话框中
    expect(screen.getByText('main.ts')).toBeInTheDocument();
  });

  it('渲染时应显示完整路径', () => {
    render(<ConflictDialog {...defaultProps} />);
    expect(screen.getByText(/\/proj\/src\/main\.ts/)).toBeInTheDocument();
  });

  it('应渲染三个操作按钮', () => {
    render(<ConflictDialog {...defaultProps} />);
    expect(screen.getByText('保留修改')).toBeInTheDocument();
    expect(screen.getByText('加载新版本')).toBeInTheDocument();
    expect(screen.getByText('查看 diff')).toBeInTheDocument();
  });

  it('点击"保留修改"按钮应触发 onKeep 回调', () => {
    const onKeep = vi.fn();
    render(<ConflictDialog {...defaultProps} onKeep={onKeep} />);

    fireEvent.click(screen.getByText('保留修改'));
    expect(onKeep).toHaveBeenCalledTimes(1);
  });

  it('点击"加载新版本"按钮应触发 onLoad 回调', () => {
    const onLoad = vi.fn();
    render(<ConflictDialog {...defaultProps} onLoad={onLoad} />);

    fireEvent.click(screen.getByText('加载新版本'));
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('点击"查看 diff"按钮应触发 onDiff 回调', () => {
    const onDiff = vi.fn();
    render(<ConflictDialog {...defaultProps} onDiff={onDiff} />);

    fireEvent.click(screen.getByText('查看 diff'));
    expect(onDiff).toHaveBeenCalledTimes(1);
  });

  it('应显示冲突说明文本', () => {
    render(<ConflictDialog {...defaultProps} />);
    expect(screen.getByText(/已被外部程序修改/)).toBeInTheDocument();
  });
});
