/**
 * @file AppLayout - 应用主布局
 * @description GhostTerm 三栏分屏布局：左侧面板 | 编辑器 | 终端
 *              使用 react-resizable-panels 支持拖拽调整比例。
 *              阶段 2.5：接入 PBI-1/2/3 全部组件。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { useEffect } from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { Sidebar } from '../features/sidebar';
import { useSidebarStore } from '../features/sidebar';
import { Editor, EditorTabs } from '../features/editor';
import { Terminal } from '../features/terminal';

/**
 * GhostTerm 三栏布局
 *
 * 布局结构：
 * 1. 左侧面板（侧边栏）- 项目选择器 + Files/Changes/Worktrees（PBI-3）
 * 2. 中间面板（编辑器）- EditorTabs + CodeMirror 6（PBI-2）
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
        {/* 左侧面板 - PBI-3 Sidebar，根据 sidebarVisible 显隐 */}
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

        {/* 中间面板 - PBI-2 编辑器 */}
        <Panel
          defaultSize={50}
          minSize={20}
          style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        >
          {/* 标签页栏 */}
          <EditorTabs />
          {/* 编辑器内容区 */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <Editor />
          </div>
        </Panel>

        <PanelResizeHandle
          style={{
            width: 1,
            background: '#27293d',
            cursor: 'col-resize',
          }}
        />

        {/* 右侧面板 - PBI-1 终端 */}
        <Panel
          defaultSize={30}
          minSize={15}
          style={{ overflow: 'hidden' }}
        >
          <Terminal />
        </Panel>
      </PanelGroup>
    </div>
  );
}
