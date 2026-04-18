/**
 * @file ToolsWorkspace.tsx
 * @description "工具" Tab 的 workspace。P2 含 ToolRunner；P3 加 Cmd+Z undo 监听。
 *              Cmd+Z 用 window listener + useEffect 实现：组件 mount 时注册，unmount 时自动解绑，
 *              不需要显式检查 activeTab（父组件控制 mount/unmount 即等价于 tab 切换）。
 * @author Atlas.oi
 * @date 2026-04-18
 */
import { useEffect } from 'react';
import { ToolRunner } from './ToolRunner';
import { useToolsStore } from './toolsStore';
import { TemplateSelector } from './templates/TemplateSelector';

export function ToolsWorkspace() {
  // Cmd+Z（macOS）/ Ctrl+Z（Windows/Linux）触发 undo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        // 直接从 store 取最新状态调用，避免 closure 捕获旧引用
        useToolsStore.getState().undo().catch((err) => {
          console.error('[ToolsWorkspace] undo failed', err);
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div data-testid="tools-workspace" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      {/* TemplateSelector 固定在工具面板顶部，Task 9 完成后传入 onManage */}
      <TemplateSelector />
      <ToolRunner />
    </div>
  );
}
