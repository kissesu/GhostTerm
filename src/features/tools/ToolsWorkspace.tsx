/**
 * @file ToolsWorkspace.tsx
 * @description "工具" Tab 的 workspace。P2 含 ToolRunner
 * @author Atlas.oi
 * @date 2026-04-17
 */
import { ToolRunner } from './ToolRunner';

export function ToolsWorkspace() {
  return (
    <div data-testid="tools-workspace" style={{ flex: 1, display: 'flex' }}>
      <ToolRunner />
    </div>
  );
}
