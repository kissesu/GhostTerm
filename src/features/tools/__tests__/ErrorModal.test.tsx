/**
 * @file ErrorModal.test.tsx
 * @description ErrorModal Section 7 文案分发测试：各 error code 显示对应友好文案，未知 code 回退通用文案
 * @author Atlas.oi
 * @date 2026-04-18
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ErrorModal } from '../ErrorModal';
import { SidecarError } from '../toolsSidecarClient';

// 构造一个最小 SidecarError 实例供测试使用
function makeError(code: string): SidecarError {
  return new SidecarError(code, `error detail for ${code}`);
}

describe('ErrorModal Section 7 文案', () => {
  it('ENOENT 错误显示"文件不存在"标题', () => {
    render(
      <ErrorModal
        error={makeError('ENOENT')}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText(/文件不存在/)).toBeInTheDocument();
    // 同时渲染建议操作行
    expect(screen.getByText(/检查文件路径/)).toBeInTheDocument();
  });

  it('EPERM 显示 Word 锁定提示', () => {
    render(
      <ErrorModal
        error={makeError('EPERM')}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText(/Word\/WPS 等程序打开/)).toBeInTheDocument();
    expect(screen.getByText(/关闭打开此文件的程序/)).toBeInTheDocument();
  });

  it('未知 code 回退到通用文案"工具执行失败"', () => {
    render(
      <ErrorModal
        error={makeError('WEIRD_CODE')}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText(/工具执行失败/)).toBeInTheDocument();
  });

  it('回退 hint 为空时不渲染建议行', () => {
    // FALLBACK_HINT.hint === '' 且 FALLBACK_HINT.action === ''
    render(
      <ErrorModal
        error={makeError('NO_SUCH_CODE')}
        onClose={vi.fn()}
      />
    );
    // 不存在"建议："前缀的行
    expect(screen.queryByText(/^建议：/)).toBeNull();
  });
});
