/**
 * @file AppLayout - 应用主布局
 * @description GhostTerm 三栏分屏布局：左侧面板 | 编辑器 | 终端
 *              使用 react-resizable-panels 支持拖拽调整比例。
 *              PBI-6：集成 useKeyboardShortcuts、焦点切换、窗口宽度自动折叠侧边栏。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { Sidebar } from '../features/sidebar';
import { useSidebarStore } from '../features/sidebar';
import { Editor, EditorTabs } from '../features/editor';
import { Terminal } from '../features/terminal';
import { useKeyboardShortcuts } from '../shared/hooks/useKeyboardShortcuts';

// 侧边栏自动折叠阈值（px）：窗口宽度小于此值时自动隐藏侧边栏
const SIDEBAR_AUTO_COLLAPSE_WIDTH = 800;

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

  // 焦点面板状态：记录当前焦点在编辑器还是终端，供快捷键和 UI 使用
  const [activePanel, setActivePanel] = useState<'editor' | 'terminal'>('editor');

  // 记录用户手动设置的侧边栏状态，避免 resize 事件覆盖用户意图
  // true = 用户手动折叠（resize 宽度恢复后不自动展开）
  // false = 自动折叠或用户手动展开（resize 宽度恢复后允许自动展开）
  const userCollapsedRef = useRef(false);

  // ============================================
  // Cmd+` 焦点切换回调（传给 useKeyboardShortcuts）
  // 在编辑器和终端之间切换焦点面板
  // ============================================
  const handleFocusToggle = useCallback((panel: 'editor' | 'terminal') => {
    setActivePanel((prev) => (prev === panel ? 'editor' : panel));
  }, []);

  // ============================================
  // Cmd+B 侧边栏切换回调（传给 useKeyboardShortcuts）
  // 更新 userCollapsedRef，区分用户主动折叠和自动折叠
  // 使 resize 逻辑知道是否应该自动恢复侧边栏
  // ============================================
  const handleSidebarToggle = useCallback(() => {
    const { visible, toggleVisibility } = useSidebarStore.getState();
    // 即将折叠（visible=true）→ 标记为用户手动折叠（不允许 resize 自动恢复）
    // 即将展开（visible=false）→ 清除手动折叠标记（允许 resize 再次自动折叠/展开）
    userCollapsedRef.current = visible;
    toggleVisibility();
  }, []);

  // ============================================
  // 注册全局快捷键（Cmd+B / Cmd+` / Cmd+S）
  // 替换原先散落在各组件的 keydown 监听，统一管理
  // ============================================
  useKeyboardShortcuts(handleFocusToggle, handleSidebarToggle);

  // ============================================
  // 窗口宽度 < 800px 时自动折叠侧边栏
  // 使用 ResizeObserver 监听 body 宽度变化，比 window.resize 更精确
  // 仅在非用户手动状态下自动切换（避免用户展开后被自动折叠覆盖）
  // ============================================
  useEffect(() => {
    const checkWidth = () => {
      const isNarrow = window.innerWidth < SIDEBAR_AUTO_COLLAPSE_WIDTH;
      const { visible, setVisibility } = useSidebarStore.getState();

      if (isNarrow && visible) {
        // 窗口变窄时自动折叠，记录为自动折叠（非用户主动）
        userCollapsedRef.current = false;
        setVisibility(false);
      } else if (!isNarrow && !visible && !userCollapsedRef.current) {
        // 窗口恢复宽度时，若侧边栏是被自动折叠的（非用户手动），则自动展开
        setVisibility(true);
      }
    };

    // 初次渲染时立即检查
    checkWidth();
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, []);

  return (
    <div
      data-active-panel={activePanel}
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
