/**
 * @file WindowTitleBar - 应用窗口标题栏
 * @description 统一封装标题栏拖拽区域、traffic lights 留白和左右操作区。
 *              高度 38px，左侧为 macOS 红绿灯留白，中间显示品牌标识或自定义内容。
 * @author Atlas.oi
 * @date 2026-04-15
 */

import type { MouseEvent, ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

function isInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest('button, a, input, textarea, select, [role="button"], [contenteditable="true"]'),
  );
}

/** GhostTerm 品牌标识：终端提示符图标 + 名称 */
function GhostTermBrand() {
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 7,
      userSelect: 'none',
    }}>
      {/* 终端提示符图标 */}
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M2 4l5 4-5 4M9 12h5"
          stroke="var(--c-accent)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span style={{
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.04em',
        color: 'var(--c-fg-muted)',
      }}>
        GhostTerm
      </span>
    </div>
  );
}

interface WindowTitleBarProps {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  /** 不传 center 时是否显示品牌标识，默认 true */
  showBrand?: boolean;
}

export default function WindowTitleBar({ left, center, right, showBrand = true }: WindowTitleBarProps) {
  const handleDoubleClick = async (event: MouseEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(event.target)) return;

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
      if (maximized) await appWindow.unmaximize();
      else await appWindow.maximize();
    }
  };

  const stopPropagation = (e: MouseEvent<HTMLElement>) => e.stopPropagation();

  return (
    <div
      onDoubleClick={(event) => void handleDoubleClick(event)}
      data-tauri-drag-region
      style={{
        height: 38,
        flexShrink: 0,
        paddingLeft: 80,   /* macOS traffic lights 留白 */
        paddingRight: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        userSelect: 'none',
        borderBottom: '1px solid var(--c-border-sub)',
        background: 'var(--c-panel)',
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
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* center 优先；若无 center 且 showBrand=true 则显示品牌标识 */}
        {center ?? (showBrand ? <GhostTermBrand /> : null)}
      </div>
      <div
        onMouseDown={stopPropagation}
        onDoubleClick={stopPropagation}
        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
      >
        {right}
      </div>
    </div>
  );
}
