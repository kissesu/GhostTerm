/**
 * @file WindowTitleBar - 应用窗口标题栏
 * @description 统一封装标题栏拖拽区域和操作区。
 *              macOS：左侧 80px 为 traffic lights 留白，无自定义窗口控件。
 *              Windows/Linux：左侧 12px 普通留白，右侧渲染最小化/最大化/关闭按钮。
 * @author Atlas.oi
 * @date 2026-04-15
 */

import type { MouseEvent, ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

// Tauri WKWebView(macOS) userAgent 含 "Macintosh"；WebView2(Windows) 含 "Windows NT"
// 用 userAgent 替代已废弃的 navigator.platform
const isMacOS = navigator.userAgent.includes('Macintosh');

function isInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest('button, a, input, textarea, select, [role="button"], [contenteditable="true"]'),
  );
}

/** GhostTerm 品牌标识：官方 Ghostty ghost 图标 + 名称 */
function GhostTermBrand() {
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 7,
      userSelect: 'none',
    }}>
      {/* 官方 Ghost 图标，路径直接来自 ghostty-wordmark.815bf882.svg */}
      <svg width="14" height="14" viewBox="-2.64 0 32 32" fill="none" aria-hidden="true">
        <path d="M20.3955 32C19.1436 32 17.9152 31.6249 16.879 30.9333C15.8428 31.6249 14.6121 32 13.3625 32C12.113 32 10.8822 31.6249 9.84606 30.9333C8.8169 31.6249 7.62598 31.9906 6.37177 32H6.33426C4.63228 32 3.0358 31.3225 1.83316 30.0941C0.64928 28.8844 -0.00244141 27.2926 -0.00244141 25.6117V13.3626C-9.70841e-05 5.99443 5.99433 0 13.3625 0C20.7307 0 26.7252 5.99443 26.7252 13.3626V25.6164C26.7252 29.0086 24.0995 31.8078 20.7472 31.9906C20.6299 31.9977 20.5127 32 20.3955 32Z" fill="#3551F3"/>
        <path d="M20.3955 30.5934C19.2773 30.5934 18.1848 30.209 17.3151 29.5104C17.165 29.3884 17.0033 29.365 16.8954 29.365C16.7243 29.365 16.5508 29.426 16.4078 29.5408C15.5451 30.2207 14.4644 30.5958 13.3625 30.5958C12.2607 30.5958 11.18 30.2207 10.3173 29.5408C10.1789 29.4306 10.0148 29.3744 9.84605 29.3744C9.67726 29.3744 9.51316 29.433 9.37485 29.5408C8.50979 30.223 7.46891 30.5864 6.36474 30.5958H6.33192C5.01675 30.5958 3.7766 30.0706 2.84122 29.1142C1.91756 28.1694 1.40649 26.9269 1.40649 25.6164V13.3673C1.40649 6.77043 6.7703 1.40662 13.3625 1.40662C19.9548 1.40662 25.3186 6.77043 25.3186 13.3627V25.6164C25.3186 28.2608 23.2767 30.4434 20.6698 30.5864C20.5784 30.5911 20.4869 30.5934 20.3955 30.5934Z" fill="black"/>
        <path d="M23.9119 13.3627V25.6165C23.9119 27.4919 22.4654 29.079 20.5923 29.1822C19.6827 29.2314 18.8435 28.936 18.1941 28.4132C17.4158 27.7873 16.321 27.8154 15.5356 28.4343C14.9378 28.9055 14.183 29.1869 13.3601 29.1869C12.5372 29.1869 11.7847 28.9055 11.1869 28.4343C10.3922 27.8084 9.29738 27.8084 8.50266 28.4343C7.90954 28.9009 7.16405 29.1822 6.35291 29.1869C4.40478 29.2009 2.81299 27.5599 2.81299 25.6118V13.3627C2.81299 7.53704 7.5368 2.81323 13.3624 2.81323C19.1881 2.81323 23.9119 7.53704 23.9119 13.3627Z" fill="white"/>
        <path d="M11.2808 12.4366L7.3494 10.1673C6.83833 9.87192 6.18192 10.0477 5.88654 10.5588C5.59115 11.0699 5.76698 11.7263 6.27804 12.0217L8.60361 13.365L6.27804 14.7083C5.76698 15.0036 5.59115 15.6577 5.88654 16.1711C6.18192 16.6822 6.83599 16.858 7.3494 16.5626L11.2808 14.2933C11.9935 13.8807 11.9935 12.8516 11.2808 12.4389V12.4366Z" fill="black"/>
        <path d="M20.1822 12.2913H15.0176C14.4269 12.2913 13.9463 12.7695 13.9463 13.3626C13.9463 13.9557 14.4245 14.434 15.0176 14.434H20.1822C20.773 14.434 21.2535 13.9557 21.2535 13.3626C21.2535 12.7695 20.7753 12.2913 20.1822 12.2913Z" fill="black"/>
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

/**
 * Windows/Linux 自定义窗口控件
 * Tauri titleBarStyle="Overlay" 移除原生标题栏后，需要手动渲染最小化/最大化/关闭
 */
function WindowControls() {
  const handleMinimize = async (e: MouseEvent) => {
    e.stopPropagation();
    const win = getCurrentWindow();
    await win.minimize();
  };

  const handleMaximize = async (e: MouseEvent) => {
    e.stopPropagation();
    const win = getCurrentWindow();
    const maximized = await win.isMaximized();
    if (maximized) await win.unmaximize();
    else await win.maximize();
  };

  const handleClose = async (e: MouseEvent) => {
    e.stopPropagation();
    const win = getCurrentWindow();
    await win.close();
  };

  const btnBase: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    border: 'none',
    background: 'transparent',
    color: 'var(--c-fg-muted)',
    cursor: 'pointer',
    borderRadius: 4,
    transition: 'background 0.12s, color 0.12s',
    flexShrink: 0,
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', marginRight: -4 }}>
      {/* 最小化 */}
      <button
        style={btnBase}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => void handleMinimize(e)}
        title="最小化"
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--c-surface-1)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
      >
        <svg width="10" height="2" viewBox="0 0 10 2" fill="none" aria-hidden="true">
          <path d="M0 1h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>

      {/* 最大化 / 还原 */}
      <button
        style={btnBase}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => void handleMaximize(e)}
        title="最大化"
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--c-surface-1)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <rect x="0.75" y="0.75" width="8.5" height="8.5" rx="1" stroke="currentColor" strokeWidth="1.5"/>
        </svg>
      </button>

      {/* 关闭 */}
      <button
        style={btnBase}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => void handleClose(e)}
        title="关闭"
        onMouseEnter={(e) => {
          const btn = e.currentTarget as HTMLButtonElement;
          btn.style.background = '#e81123';
          btn.style.color = '#ffffff';
        }}
        onMouseLeave={(e) => {
          const btn = e.currentTarget as HTMLButtonElement;
          btn.style.background = 'transparent';
          btn.style.color = 'var(--c-fg-muted)';
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}

interface WindowTitleBarProps {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  /** 不传 center 时是否显示品牌标识，默认 true */
  showBrand?: boolean;
  /**
   * 传入后切换为"主窗口"布局：
   * 品牌（左） → flex spacer → tabs（中） → right → Win32 controls（Windows）
   * 传此 prop 时 left/center/showBrand 被忽略，新布局全权管理左侧区域
   */
  tabs?: ReactNode;
}

export default function WindowTitleBar({ left, center, right, showBrand = true, tabs }: WindowTitleBarProps) {
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

  // 外层拖拽区域的公共样式
  // paddingLeft 用 max(最小值, 百分比)：窄窗口保留红黄绿/基础留白，宽窗口按比例右移品牌
  const outerStyle: React.CSSProperties = {
    height: 38,
    flexShrink: 0,
    // macOS：红黄绿至少 80px，窗口 >1333px 后按 6% 扩大
    // Windows/Linux：基础 12px，窗口较宽时按 3% 扩大
    paddingLeft: isMacOS ? 'max(80px, 6%)' : 'max(12px, 3%)',
    // Windows 自渲染控件时右侧不加 padding（控件自带 margin）
    paddingRight: isMacOS ? 'max(12px, 2%)' : 0,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    userSelect: 'none',
    borderBottom: '1px solid var(--c-border-sub)',
    background: 'var(--c-bg)',
  };

  // ============================================================
  // 主窗口布局（tabs 传入时）：
  // 品牌 → tabs → flex spacer → 右侧按钮 → Win32 controls
  // ============================================================
  if (tabs) {
    return (
      <div
        onDoubleClick={(event) => void handleDoubleClick(event)}
        data-tauri-drag-region
        style={outerStyle}
        data-testid="window-titlebar"
      >
        {/* 1. 品牌区（左对齐，非拖拽） */}
        <div
          onMouseDown={stopPropagation}
          onDoubleClick={stopPropagation}
          style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}
        >
          <GhostTermBrand />
        </div>

        {/* 2. tabs 区（紧挨品牌右侧，非拖拽）；marginLeft 撑出 brand↔tabs 视觉间距 */}
        <div
          onMouseDown={stopPropagation}
          onDoubleClick={stopPropagation}
          style={{ display: 'flex', alignItems: 'center', flexShrink: 0, marginLeft: 16 }}
        >
          {tabs}
        </div>

        {/* 3. 弹性空白（可拖拽）：把右侧按钮推到最右 */}
        <div data-tauri-drag-region style={{ flex: 1 }} />

        {/* 4. 右侧按钮 + Windows 窗口控件（非拖拽） */}
        <div
          onMouseDown={stopPropagation}
          onDoubleClick={stopPropagation}
          style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
        >
          {right}
          {/* Windows/Linux 自渲染窗口控件 */}
          {!isMacOS && <WindowControls />}
        </div>
      </div>
    );
  }

  // ============================================================
  // 旧版布局（兼容 SettingsPage 等消费者）：
  // left | center/brand | right
  // ============================================================
  return (
    <div
      onDoubleClick={(event) => void handleDoubleClick(event)}
      data-tauri-drag-region
      style={outerStyle}
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
        {/* Windows/Linux 自渲染窗口控件，替代原生标题栏按钮 */}
        {!isMacOS && <WindowControls />}
      </div>
    </div>
  );
}
