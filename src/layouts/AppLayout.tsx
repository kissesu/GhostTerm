/**
 * @file AppLayout - 应用主布局
 * @description GhostTerm 三栏分屏布局：左侧面板 | 编辑器 | 终端
 *              使用 react-resizable-panels 支持拖拽调整比例。
 *              各功能模块在对应 PBI 完成后接入此布局。
 *              PBI-3：接入 Sidebar 组件，Cmd+B 控制侧边栏显隐。
 * @author Atlas.oi
 * @date 2026-04-12
 */

import { useEffect } from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { Sidebar } from '../features/sidebar';
import { useSidebarStore } from '../features/sidebar';

/**
 * GhostTerm 三栏布局
 *
 * 布局结构：
 * 1. 左侧面板（侧边栏）- 项目选择器 + Files/Changes/Worktrees 标签（PBI-3）
 * 2. 中间面板（编辑器）- CodeMirror 6 + 多标签页（PBI-2）
 * 3. 右侧面板（终端）- xterm.js + WebSocket（PBI-1）
 */
export default function AppLayout() {
  const sidebarVisible = useSidebarStore((s) => s.visible);

  // ============================================
  // Cmd+B 快捷键：切换侧边栏显隐
  // 监听全局 keydown，使用 metaKey（Mac）或 ctrlKey（Windows/Linux）
  // ============================================
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        useSidebarStore.getState().toggleVisibility();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: '#1a1b26',
        color: '#c0caf5',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <PanelGroup direction="horizontal" style={{ flex: 1 }}>
        {/* 左侧面板 - 根据 sidebarVisible 条件显示/隐藏 */}
        {sidebarVisible && (
          <>
            <Panel
              defaultSize={20}
              minSize={10}
              maxSize={40}
              style={{ background: '#16161e', overflow: 'hidden' }}
            >
              <Sidebar />
            </Panel>

            <PanelResizeHandle
              style={{
                width: 1,
                background: '#27293d',
                cursor: 'col-resize',
              }}
            />
          </>
        )}

        {/* 中间面板 - PBI-2 接入 Editor 组件 */}
        <Panel
          defaultSize={50}
          minSize={20}
          style={{ overflow: 'hidden' }}
        >
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#565f89',
              fontSize: 12,
            }}
          >
            编辑器 (PBI-2)
          </div>
        </Panel>

        <PanelResizeHandle
          style={{
            width: 1,
            background: '#27293d',
            cursor: 'col-resize',
          }}
        />

        {/* 右侧面板 - PBI-1 接入 Terminal 组件 */}
        <Panel
          defaultSize={30}
          minSize={15}
          style={{ overflow: 'hidden' }}
        >
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#565f89',
              fontSize: 12,
            }}
          >
            终端 (PBI-1)
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
