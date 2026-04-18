/**
 * @file ToolsWorkspace.tsx
 * @description "工具" Tab 的 workspace。P2 含 ToolRunner；P3 加 Cmd+Z undo 监听。
 *              Cmd+Z 用 window listener + useEffect 实现：组件 mount 时注册，unmount 时自动解绑，
 *              不需要显式检查 activeTab（父组件控制 mount/unmount 即等价于 tab 切换）。
 * @author Atlas.oi
 * @date 2026-04-18
 */
import { useEffect, useState } from 'react';
import { ToolRunner } from './ToolRunner';
import { useToolsStore } from './toolsStore';
import { TemplateSelector } from './templates/TemplateSelector';
import { TemplateManager } from './templates/TemplateManager';
import { MigrationBanner } from './templates/MigrationBanner';
import { ToolBoxGrid } from './ToolBoxGrid';

export function ToolsWorkspace() {
  // 控制 TemplateManager modal 的显示状态
  const [managerOpen, setManagerOpen] = useState(false);

  // activeToolId: null = 显示分类卡片入口；非 null = 显示对应工具运行器
  const { activeToolId, setActiveTool } = useToolsStore();

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
      {/* TemplateSelector 固定在工具面板顶部，onManage 打开管理 modal */}
      <TemplateSelector onManage={() => setManagerOpen(true)} />
      {/* 检测到新规则时显示迁移提示横幅，用户确认后消失 */}
      <MigrationBanner />
      {/* activeToolId 为 null 时展示分类卡片入口，非 null 时展示 ToolRunner */}
      {activeToolId === null ? (
        <ToolBoxGrid onSelectTool={(tb) => setActiveTool(tb.id)} />
      ) : (
        <ToolRunner />
      )}
      {/* 模板管理 modal（isOpen=false 时不渲染任何 DOM） */}
      <TemplateManager isOpen={managerOpen} onClose={() => setManagerOpen(false)} />
    </div>
  );
}
