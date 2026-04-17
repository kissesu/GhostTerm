/**
 * @file ToolsWorkspace.tsx
 * @description "工具" Tab 的 workspace。P1 阶段为占位，P2 接入工具箱
 * @author Atlas.oi
 * @date 2026-04-17
 */
import { Wrench } from 'lucide-react';

export function ToolsWorkspace() {
  return (
    <div
      data-testid="tools-workspace"
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 12,
        color: 'var(--c-fg-muted)',
        background: 'var(--c-bg)',
      }}
    >
      <Wrench size={32} style={{ opacity: 0.5 }} />
      <div style={{ fontSize: 14 }}>工具箱 — 敬请期待</div>
      <div style={{ fontSize: 12, color: 'var(--c-fg-subtle)' }}>
        论文格式检测、引用格式化、写作质量辅助等规则型工具
      </div>
    </div>
  );
}
