/**
 * @file useKeyboardShortcuts.ts
 * @description 全局键盘快捷键管理 Hook - 集中注册所有应用级快捷键。
 *              在 AppLayout 挂载时调用一次，统一处理快捷键路由。
 *              PBI-6：实现 Cmd+B（侧边栏）、Cmd+`（焦点切换）、Cmd+S（保存）。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { useEffect } from 'react';
import { useSidebarStore } from '../../features/sidebar/sidebarStore';
import { useEditorStore } from '../../features/editor/editorStore';

/**
 * 注册全局键盘快捷键
 *
 * 业务逻辑：
 * 1. Cmd/Ctrl+B  → 切换侧边栏显隐（委托 sidebarStore.toggleVisibility）
 * 2. Cmd/Ctrl+`  → 在编辑器和终端面板间切换焦点（通过回调通知布局组件）
 * 3. Cmd/Ctrl+S  → 保存当前激活的编辑器文件（委托 editorStore.saveFile）
 *
 * @param onFocusToggle - 焦点切换回调，由布局组件提供，参数为目标面板 ('editor' | 'terminal')
 */
export function useKeyboardShortcuts(
  onFocusToggle?: (panel: 'editor' | 'terminal') => void,
): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;

      switch (e.key) {
        // ============================================
        // Cmd+B：切换侧边栏显隐
        // 与 VSCode 保持一致的快捷键习惯
        // ============================================
        case 'b': {
          e.preventDefault();
          useSidebarStore.getState().toggleVisibility();
          break;
        }

        // ============================================
        // Cmd+`：切换编辑器/终端焦点
        // ` 键在键盘左上角，方便单手快速切换
        // ============================================
        case '`': {
          e.preventDefault();
          if (onFocusToggle) {
            // 布局组件维护当前焦点面板状态，此处通过回调通知
            onFocusToggle('terminal');
          }
          break;
        }

        // ============================================
        // Cmd+S：保存当前激活文件
        // 前提：编辑器有激活文件且文件为脏状态
        // ============================================
        case 's': {
          e.preventDefault();
          const { activeFilePath, saveFile } = useEditorStore.getState();
          if (activeFilePath) {
            // 不 await，保存为"发起后不等待"模式，保持 UI 响应
            saveFile(activeFilePath).catch((err: unknown) => {
              console.error('[快捷键] 保存文件失败:', err);
            });
          }
          break;
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onFocusToggle]);
}
