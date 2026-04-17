/**
 * @file ProgressWorkspace.tsx
 * @description "进度" Tab 的 workspace。P1 阶段为占位，工具分区完善后开放
 * @author Atlas.oi
 * @date 2026-04-17
 */
import { BarChart3 } from 'lucide-react';

export function ProgressWorkspace() {
  return (
    <div
      data-testid="progress-workspace"
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
      <BarChart3 size={32} style={{ opacity: 0.5 }} />
      <div style={{ fontSize: 14 }}>进度 — 敬请期待</div>
      <div style={{ fontSize: 12, color: 'var(--c-fg-subtle)' }}>
        等工具分区完善后开放
      </div>
    </div>
  );
}
