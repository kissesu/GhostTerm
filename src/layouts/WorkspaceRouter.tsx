/**
 * @file WorkspaceRouter.tsx
 * @description 三 workspace 并列常驻 DOM，通过 display:none 保活
 *              （终端 PTY / 编辑器 session 不 unmount，参照 feedback_xterm_display_none）
 * @author Atlas.oi
 * @date 2026-04-17
 */
import { useTabStore, type Tab } from '../shared/stores/tabStore';
import { ProjectWorkspace } from './ProjectWorkspace';
import { ToolsWorkspace } from '../features/tools';
import { ProgressWorkspace } from '../features/progress';

interface WorkspaceRouterProps {
  sidebarVisible: boolean;
}

// 根据当前激活 tab 决定某个 workspace 的显示状态
function tabDisplay(active: Tab, tab: Tab): 'flex' | 'none' {
  return active === tab ? 'flex' : 'none';
}

export function WorkspaceRouter({ sidebarVisible }: WorkspaceRouterProps) {
  const activeTab = useTabStore((s) => s.activeTab);
  return (
    <>
      <div style={{ display: tabDisplay(activeTab, 'project'), flex: 1, minHeight: 0, minWidth: 0 }}>
        <ProjectWorkspace sidebarVisible={sidebarVisible} />
      </div>
      <div style={{ display: tabDisplay(activeTab, 'tools'), flex: 1, minHeight: 0, minWidth: 0 }}>
        <ToolsWorkspace />
      </div>
      <div style={{ display: tabDisplay(activeTab, 'progress'), flex: 1, minHeight: 0, minWidth: 0 }}>
        <ProgressWorkspace />
      </div>
    </>
  );
}
