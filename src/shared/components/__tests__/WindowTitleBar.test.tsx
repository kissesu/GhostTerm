import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import WindowTitleBar from '../WindowTitleBar';

const mockGetCurrentWindow = vi.mocked(getCurrentWindow);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentWindow.mockReturnValue({
    startDragging: vi.fn(),
    toggleMaximize: vi.fn(),
  } as unknown as ReturnType<typeof getCurrentWindow>);
});

describe('WindowTitleBar', () => {
  it('双击标题栏空白区域应切换窗口最大化', async () => {
    const toggleMaximize = vi.fn().mockResolvedValue(undefined);
    mockGetCurrentWindow.mockReturnValue({
      startDragging: vi.fn(),
      toggleMaximize,
    } as unknown as ReturnType<typeof getCurrentWindow>);

    render(<WindowTitleBar center={<span>GhostTerm</span>} />);
    fireEvent.doubleClick(screen.getByTestId('window-titlebar'));

    expect(toggleMaximize).toHaveBeenCalledTimes(1);
  });

  it('双击左右操作区不应触发窗口最大化', () => {
    const toggleMaximize = vi.fn();
    mockGetCurrentWindow.mockReturnValue({
      startDragging: vi.fn(),
      toggleMaximize,
    } as unknown as ReturnType<typeof getCurrentWindow>);

    render(
      <WindowTitleBar
        left={<button type="button">返回</button>}
        right={<button type="button">设置</button>}
      />,
    );

    fireEvent.doubleClick(screen.getByRole('button', { name: '返回' }));
    fireEvent.doubleClick(screen.getByRole('button', { name: '设置' }));

    expect(toggleMaximize).not.toHaveBeenCalled();
  });
});
