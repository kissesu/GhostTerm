/**
 * @file Toast.test.tsx
 * @description Toast 组件 + useToastStore 单测
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Toast } from '../Toast';
import { useToastStore } from '../../stores/toastStore';

afterEach(() => {
  // 每测试后重置 store 状态，防止 timer 跨测试污染
  useToastStore.setState({ message: null, visible: false });
});

describe('useToastStore', () => {
  it('show() 后 visible=true + message 正确', () => {
    act(() => {
      useToastStore.getState().show('操作成功');
    });
    const { message, visible } = useToastStore.getState();
    expect(message).toBe('操作成功');
    expect(visible).toBe(true);
  });

  it('hide() 后 visible=false', () => {
    act(() => {
      useToastStore.getState().show('测试');
      useToastStore.getState().hide();
    });
    expect(useToastStore.getState().visible).toBe(false);
  });

  it('timer 到期后 visible=false（防竞争：message 仍是同条）', () => {
    vi.useFakeTimers();
    act(() => {
      useToastStore.getState().show('计时测试', 500);
    });
    expect(useToastStore.getState().visible).toBe(true);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(useToastStore.getState().visible).toBe(false);
    vi.useRealTimers();
  });

  it('后续 show 不被先前 timer 误 hide', () => {
    vi.useFakeTimers();
    act(() => {
      useToastStore.getState().show('第一条', 500);
    });
    // 在第一条 timer 到期前，发第二条
    act(() => {
      vi.advanceTimersByTime(200);
      useToastStore.getState().show('第二条', 500);
    });
    // 第一条 timer 应不 hide 第二条 message
    act(() => {
      vi.advanceTimersByTime(300); // 第一条 timer 到期点
    });
    expect(useToastStore.getState().message).toBe('第二条');
    expect(useToastStore.getState().visible).toBe(true);
    vi.useRealTimers();
  });
});

describe('Toast 组件', () => {
  it('message=null 时返回 null（无 DOM 元素）', () => {
    const { container } = render(<Toast />);
    expect(container.firstChild).toBeNull();
  });

  it('show 后渲染 message 文本', () => {
    act(() => {
      useToastStore.getState().show('项目已提交');
    });
    render(<Toast />);
    expect(screen.getByText('项目已提交')).toBeInTheDocument();
  });

  it('渲染 role=status + aria-live=polite（a11y）', () => {
    act(() => {
      useToastStore.getState().show('a11y 测试');
    });
    render(<Toast />);
    const el = screen.getByRole('status');
    expect(el).toBeInTheDocument();
    expect(el.getAttribute('aria-live')).toBe('polite');
  });
});
