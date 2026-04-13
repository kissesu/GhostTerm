/**
 * @file Terminal.tsx - xterm.js 终端渲染组件
 * @description 集成 xterm.js + WebGL addon + Unicode11 addon + AttachAddon + FitAddon。
 *              通过 AttachAddon 将 xterm.js 直接连接到 PTY WebSocket server（二进制帧）。
 *              使用 ResizeObserver 监听容器尺寸变化，触发 FitAddon.fit() 和 PTY resize。
 *              连接失败时显示错误 UI 和重试按钮。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { AttachAddon } from '@xterm/addon-attach';
import { FitAddon } from '@xterm/addon-fit';
import { useThemeStore } from '../../shared/stores/themeStore';
import { useTerminalStore } from './terminalStore';
import { useTerminal } from './useTerminal';
import '@xterm/xterm/css/xterm.css';

/** Terminal 组件 Props */
interface TerminalProps {
  /** 初始工作目录，spawn PTY 时使用 */
  cwd?: string;
  /** 容器样式类名 */
  className?: string;
}

/**
 * Terminal - xterm.js 终端组件
 *
 * 挂载流程：
 * 1. useEffect 挂载时初始化 XTerm 实例并 open 到 DOM 容器
 * 2. 加载 WebglAddon（失败时 fallback 到 Canvas2D）
 * 3. 加载 Unicode11Addon 支持中文/宽字符
 * 4. 加载 FitAddon 自适应容器尺寸
 * 5. terminalStore.spawn(cwd) 启动 PTY，获取 wsPort/wsToken
 * 6. useTerminal hook 建立 WebSocket 连接
 * 7. 加载 AttachAddon(ws) 连接 WebSocket
 * 8. ResizeObserver 监听容器尺寸 -> fitAddon.fit() -> resize_pty
 */
export default function Terminal({ cwd = '/', className }: TerminalProps) {
  // 终端 DOM 容器 ref
  const containerRef = useRef<HTMLDivElement>(null);
  // XTerm 实例 ref（在多个 effect 中共享）
  const termRef = useRef<XTerm | null>(null);
  // FitAddon ref（供 ResizeObserver 使用）
  const fitAddonRef = useRef<FitAddon | null>(null);

  // 错误状态：连接失败或 PTY 退出
  const [error, setError] = useState<string | null>(null);

  const terminalTheme = useThemeStore((s) => s.terminalTheme);
  const spawn = useTerminalStore((s) => s.spawn);
  const connected = useTerminalStore((s) => s.connected);
  const ptyId = useTerminalStore((s) => s.ptyId);
  const resize = useTerminalStore((s) => s.resize);

  // 获取 WebSocket ref（由 useTerminal 管理连接生命周期）
  const { wsRef } = useTerminal();

  // ============================================
  // Effect 1：初始化 XTerm 实例
  // 只执行一次（依赖项为空数组），组件卸载时 dispose
  // ============================================
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      theme: terminalTheme,
      // 字体配置：优先使用等宽字体，支持中文
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      // 性能优化：减少不必要的渲染
      scrollback: 1000,
      // 允许透明背景（与编辑器面板视觉一致）
      allowTransparency: false,
      // Unicode11Addon 使用 proposed API，需要此选项启用
      allowProposedApi: true,
    });

    // 加载 Unicode11Addon 支持 emoji 和中文宽字符
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = '11';

    // 加载 FitAddon 支持自适应容器尺寸
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;

    // 将终端挂载到 DOM
    term.open(containerRef.current);
    termRef.current = term;

    // 加载 WebglAddon（失败时 fallback 到默认 Canvas2D 渲染）
    // WebGL 渲染性能更好，但某些环境（如 headless）不支持
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        // WebGL context 丢失时 dispose addon，终端会自动降级到 Canvas2D
        webglAddon.dispose();
      });
      term.loadAddon(webglAddon);
    } catch {
      // WebGL 不可用，使用默认 Canvas2D 渲染
    }

    // 初始适配容器尺寸
    // 延迟到下一帧：term.open() 后渲染器需要一帧时间初始化 _renderer
    // 立即调用 fit() 会因 _renderer 未就绪而抛 TypeError
    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
      } catch {
        // 组件可能已卸载（StrictMode 双重挂载），忽略
      }
    });

    return () => {
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, []); // 仅挂载时执行一次

  // ============================================
  // Effect 2：启动 PTY（cwd 变化时重启）
  // 未打开项目时（cwd=undefined）不 spawn，等待项目打开
  // ============================================
  useEffect(() => {
    if (!cwd) return;
    spawn(cwd).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`PTY 启动失败: ${msg}`);
    });
  }, [cwd]); // cwd 变化时重新 spawn

  // ============================================
  // Effect 3：WebSocket 连接后加载 AttachAddon
  // wsRef.current 更新时（useTerminal 建立连接后）执行
  // ============================================
  useEffect(() => {
    if (!connected || !wsRef.current || !termRef.current) return;
    // 清除之前的错误状态
    setError(null);
    // AttachAddon 将 xterm.js 直接绑定到 WebSocket
    // - xterm.js 输出写入 WebSocket（-> PTY stdin）
    // - WebSocket 接收数据写入 xterm.js（PTY stdout）
    const attachAddon = new AttachAddon(wsRef.current);
    termRef.current.loadAddon(attachAddon);

    return () => {
      attachAddon.dispose();
    };
  }, [connected, wsRef.current]); // connected 或 ws 变化时重新绑定

  // ============================================
  // Effect 4：主题同步
  // terminalTheme 变化时更新 xterm.js 配色
  // ============================================
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = terminalTheme;
    }
  }, [terminalTheme]);

  // ============================================
  // Effect 5：ResizeObserver 监听容器尺寸变化
  // 容器尺寸变化时：fitAddon.fit() -> 计算 rows/cols -> 通知 Rust PTY resize
  // ============================================
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver(() => {
      if (!fitAddonRef.current || !termRef.current || !ptyId) return;
      try {
        fitAddonRef.current.fit();
        const cols = termRef.current.cols;
        const rows = termRef.current.rows;
        // 通知后端 PTY 调整窗口尺寸（SIGWINCH）
        resize(cols, rows).catch(() => {
          // resize 失败不阻塞渲染，静默处理
        });
      } catch {
        // fit 可能在组件销毁后调用，忽略
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [ptyId]); // ptyId 建立后才开始监听

  // ============================================
  // 错误 UI：PTY 启动失败或连接断开时显示
  // ============================================
  if (error && !connected) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          background: terminalTheme.background,
          color: terminalTheme.foreground,
          gap: '12px',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ color: '#f7768e', fontSize: '14px' }}>
          终端连接失败: {error}
        </div>
        <button
          onClick={() => {
            setError(null);
            spawn(cwd).catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              setError(`PTY 启动失败: ${msg}`);
            });
          }}
          style={{
            padding: '6px 16px',
            background: '#7aa2f7',
            color: '#1a1b26',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '13px',
          }}
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        width: '100%',
        height: '100%',
        // xterm.js 需要 overflow hidden 防止滚动条干扰 FitAddon 计算
        overflow: 'hidden',
        background: terminalTheme.background as string,
      }}
      data-testid="terminal-container"
    />
  );
}
