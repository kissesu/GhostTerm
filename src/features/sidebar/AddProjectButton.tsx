/**
 * @file AddProjectButton.tsx
 * @description 侧边栏底部固定的"添加项目"按钮。
 *              点击后打开 AddProjectDialog 弹窗（本地/克隆/SSH）。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { Plus } from 'lucide-react';
import AddProjectDialog from './AddProjectDialog';
import { useSidebarUiStore } from './sidebarUiStore';

/** 侧边栏底部添加项目按钮 */
export default function AddProjectButton() {
  const dialogOpen = useSidebarUiStore((s) => s.addProjectDialogOpen);
  const openAddProjectDialog = useSidebarUiStore((s) => s.openAddProjectDialog);
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
          padding: '14px 16px',
          border: 'none',
          borderTop: '1px solid #27293d',
          background: 'transparent',
          color: '#8e93ad',
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        <Plus size={16} />
        添加项目
      </button>

      {dialogOpen && <AddProjectDialog onClose={closeAddProjectDialog} />}
    </>
  );
}
