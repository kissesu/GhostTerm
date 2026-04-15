/**
 * @file AddProjectButton.tsx - 侧边栏底部添加项目按钮
 * @description 重设计：更清晰的 accent 提示色，视觉上有重量感但不抢镜。
 * @author Atlas.oi
 * @date 2026-04-15
 */

import { Plus } from 'lucide-react';
import AddProjectDialog from './AddProjectDialog';
import { useSidebarUiStore } from './sidebarUiStore';

export default function AddProjectButton() {
  const dialogOpen            = useSidebarUiStore((s) => s.addProjectDialogOpen);
  const openAddProjectDialog  = useSidebarUiStore((s) => s.openAddProjectDialog);
  const closeAddProjectDialog = useSidebarUiStore((s) => s.closeAddProjectDialog);

  return (
    <>
      <button
        type="button"
        onClick={() => openAddProjectDialog()}
        data-testid="add-project-btn"
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '11px 14px',
          border: 'none',
          borderTop: '1px solid var(--c-border-sub)',
          background: 'transparent',
          color: 'var(--c-fg-muted)',
          fontSize: 12,
          fontWeight: 500,
          fontFamily: 'var(--font-ui)',
          cursor: 'pointer',
          transition: 'color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out)',
        }}
        onMouseEnter={(e) => {
          const btn = e.currentTarget as HTMLButtonElement;
          btn.style.color = 'var(--c-accent)';
          btn.style.background = 'var(--c-accent-glow)';
        }}
        onMouseLeave={(e) => {
          const btn = e.currentTarget as HTMLButtonElement;
          btn.style.color = 'var(--c-fg-muted)';
          btn.style.background = 'transparent';
        }}
      >
        <span style={{
          width: 18, height: 18,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 'var(--r-xs)',
          border: '1px solid currentColor',
          flexShrink: 0,
          opacity: 0.8,
        }}>
          <Plus size={11} />
        </span>
        添加项目
      </button>

      {dialogOpen && <AddProjectDialog onClose={closeAddProjectDialog} />}
    </>
  );
}
