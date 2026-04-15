/**
 * @file WindowTitleBar - 应用窗口标题栏
 * @description 统一封装标题栏拖拽区域、traffic lights 留白和右侧操作区。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import type { MouseEvent, ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

function isInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest('button, a, input, textarea, select, [role="button"], [contenteditable="true"]'));
}

interface WindowTitleBarProps {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
}

export default function WindowTitleBar({ left, center, right }: WindowTitleBarProps) {
  const handleDoubleClick = async (event: MouseEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(event.target)) {
      return;
    }

    const appWindow = getCurrentWindow() as ReturnType<typeof getCurrentWindow> & {
      toggleMaximize?: () => Promise<void> | void;
      isMaximized?: () => Promise<boolean>;
      maximize?: () => Promise<void> | void;
      unmaximize?: () => Promise<void> | void;
    };

    if (typeof appWindow.toggleMaximize === 'function') {
      await appWindow.toggleMaximize();
      return;
    }

    if (
      typeof appWindow.isMaximized === 'function' &&
      typeof appWindow.maximize === 'function' &&
      typeof appWindow.unmaximize === 'function'
    ) {
      const maximized = await appWindow.isMaximized();
      if (maximized) {
        await appWindow.unmaximize();
      } else {
        await appWindow.maximize();
      }
    }
  };

  const stopPropagation = (e: MouseEvent<HTMLElement>) => {
    e.stopPropagation();
  };

  return (
    <div
      onDoubleClick={(event) => void handleDoubleClick(event)}
      data-tauri-drag-region
      style={{
        height: 28,
        flexShrink: 0,
        paddingLeft: 78,
        paddingRight: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        userSelect: 'none',
      }}
      data-testid="window-titlebar"
    >
      <div
        onMouseDown={stopPropagation}
        onDoubleClick={stopPropagation}
        style={{ display: 'flex', alignItems: 'center', gap: 8 }}
      >
        {left}
      </div>
      <div
        data-tauri-drag-region
        style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        
        {center}
      </div>
      <div
        onMouseDown={stopPropagation}
        onDoubleClick={stopPropagation}
        style={{ display: 'flex', alignItems: 'center', gap: 8 }}
      >
        {right}
      </div>
    </div>
  );
}
