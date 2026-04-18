/**
 * @file MigrationBanner.tsx
 * @description 模板规则迁移提示横幅。
 *   当 load() 检测到 sidecar 支持了内置模板尚未收录的新规则，
 *   pendingMigrationCount > 0 时显示此横幅，告知用户新规则已追加（默认未启用）。
 *   用户点"知道了"后清零，横幅消失。
 * @author Atlas.oi
 * @date 2026-04-18
 */

import { useTemplateStore } from './TemplateStore';

export function MigrationBanner() {
  const pendingMigrationCount = useTemplateStore((s) => s.pendingMigrationCount);
  const acknowledgeMigration = useTemplateStore((s) => s.acknowledgeMigration);

  // pendingMigrationCount 为 0 时不渲染任何内容
  if (pendingMigrationCount === 0) return null;

  return (
    <div
      data-testid="migration-banner"
      style={{
        margin: '6px 8px',
        padding: '8px 12px',
        background: 'var(--c-accent-dim)',
        border: '1px solid var(--c-accent)',
        borderRadius: 'var(--r-sm)',
        display: 'flex',
        gap: 8,
        alignItems: 'center',
      }}
    >
      <span style={{ flex: 1, fontSize: 13, color: 'var(--c-text)' }}>
        发现 {pendingMigrationCount} 条新规则已添加（默认未启用），可在「管理模板」中启用。
      </span>
      <button
        onClick={acknowledgeMigration}
        style={{
          flexShrink: 0,
          fontSize: 12,
          padding: '3px 10px',
          background: 'var(--c-surface)',
          border: '1px solid var(--c-border)',
          borderRadius: 'var(--r-sm)',
          color: 'var(--c-text)',
          cursor: 'pointer',
        }}
      >
        知道了
      </button>
    </div>
  );
}
