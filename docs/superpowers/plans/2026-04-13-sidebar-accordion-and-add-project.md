# Sidebar Accordion + Add Project Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the sidebar from a global Files/Changes/Worktrees tab layout to an accordion pattern where each project expands its own detail tabs, and add an "Add Repository" dialog at the sidebar bottom.

**Architecture:** The current global tab area (Sidebar.tsx) is eliminated. ProjectListItem gains an expandable section that shows Files/Changes/Worktrees tabs when the project is the current project. A new AddProjectDialog component provides Local/Clone/SSH repository addition with group assignment. The expanded project is derived from `currentProject.path` — no new state needed.

**Tech Stack:** React, Zustand, Tauri dialog plugin, lucide-react icons

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/features/sidebar/Sidebar.tsx` | Simplified container: ProjectSelector + AddProject bottom bar |
| Modify | `src/features/sidebar/ProjectListItem.tsx` | Accordion: expandable Files/Changes/Worktrees section under active project |
| Modify | `src/features/sidebar/ProjectList.tsx` | Remove maxHeight cap, pass tab-related props |
| Modify | `src/features/sidebar/ProjectSelector.tsx` | Remove "打开文件夹" button and bottom stats bar |
| Create | `src/features/sidebar/AddProjectButton.tsx` | Fixed bottom bar with "+ 添加项目" button |
| Create | `src/features/sidebar/AddProjectDialog.tsx` | Modal: Local/Clone/SSH tabs, directory picker, group selector |
| Modify | `src/features/sidebar/index.ts` | Export new components |

---

### Task 1: Simplify Sidebar.tsx — Remove Global Tabs

**Files:**
- Modify: `src/features/sidebar/Sidebar.tsx`

The global Files/Changes/Worktrees tab area is removed. Sidebar becomes a flex column with ProjectSelector (flex: 1, scrollable) and AddProjectButton pinned at the bottom.

- [ ] **Step 1: Rewrite Sidebar.tsx**

Replace the entire component body. Remove imports for FileTree, Changes, Worktrees, useSidebarStore tabs. Add AddProjectButton import.

```tsx
/**
 * @file Sidebar.tsx
 * @description 侧边栏根组件 - 项目选择器（含手风琴式详情）+ 底部添加项目按钮。
 *              Files/Changes/Worktrees 标签页已移入 ProjectListItem 的手风琴展开区。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import ProjectSelector from './ProjectSelector';
import AddProjectButton from './AddProjectButton';

/** 侧边栏根组件 */
export default function Sidebar() {
  return (
    <div
      style={{
        height: '100%',
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#16161e',
        overflow: 'hidden',
      }}
      data-testid="sidebar-root"
    >
      {/* 项目选择器（含手风琴式 Files/Changes/Worktrees） */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <ProjectSelector />
      </div>

      {/* 底部固定：添加项目按钮 */}
      <AddProjectButton />
    </div>
  );
}
```

- [ ] **Step 2: Verify build compiles**

Run: `cd /Users/oi/CodeCoding/Code/自研项目/GhostTerm && pnpm tsc --noEmit`

This will fail because AddProjectButton doesn't exist yet — that's expected. Confirm the error is only about the missing import, not about Sidebar's structure.

- [ ] **Step 3: Commit**

```bash
git add src/features/sidebar/Sidebar.tsx
git commit -m "refactor: simplify Sidebar to container for ProjectSelector + AddProjectButton"
```

---

### Task 2: Create AddProjectButton Component

**Files:**
- Create: `src/features/sidebar/AddProjectButton.tsx`

A simple fixed bottom bar with a "+" icon and "添加项目" text. Clicking opens the AddProjectDialog (Task 6).

- [ ] **Step 1: Create AddProjectButton.tsx**

```tsx
/**
 * @file AddProjectButton.tsx
 * @description 侧边栏底部固定的"添加项目"按钮。
 *              点击后打开 AddProjectDialog 弹窗（本地/克隆/SSH）。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { useState } from 'react';
import { Plus } from 'lucide-react';
import AddProjectDialog from './AddProjectDialog';

/** 侧边栏底部添加项目按钮 */
export default function AddProjectButton() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
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

      {dialogOpen && <AddProjectDialog onClose={() => setDialogOpen(false)} />}
    </>
  );
}
```

- [ ] **Step 2: Verify the component renders**

This will compile once AddProjectDialog exists (Task 6). For now, create a stub.

- [ ] **Step 3: Commit**

```bash
git add src/features/sidebar/AddProjectButton.tsx
git commit -m "feat: add AddProjectButton component for sidebar bottom"
```

---

### Task 3: Accordion in ProjectListItem — Expand Tabs Under Active Project

**Files:**
- Modify: `src/features/sidebar/ProjectListItem.tsx`

When the project is the currently active project (`active === true`), render an expandable section below the project card containing the Files/Changes/Worktrees tabs and the corresponding panel content.

- [ ] **Step 1: Add tab imports and expanded section**

Add imports for FileTree, Changes, Worktrees, useSidebarStore at the top. Then after the project card `div` (and before the group menu), render the accordion section when `active` is true.

The full rewritten component:

```tsx
/**
 * @file ProjectListItem.tsx
 * @description 项目列表单项 - 包含项目卡片和手风琴式展开区。
 *              当项目为当前活跃项目时，卡片下方展开 Files/Changes/Worktrees 标签页。
 *              同一时间只有一个项目可展开（由 active prop 控制，来自 currentProject）。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { FolderCode, Plus, SlidersHorizontal } from 'lucide-react';
import type { ProjectInfo } from '../../shared/types';
import ProjectGroupIcon from './ProjectGroupIcon';
import type { VisibleProjectGroup } from './projectGroupingStore';
import FileTree from './FileTree';
import Changes from './Changes';
import Worktrees from './Worktrees';
import { useSidebarStore, type SidebarTab } from './sidebarStore';

/** 手风琴内的标签页定义 */
const TABS: { key: SidebarTab; label: string }[] = [
  { key: 'files', label: 'Files' },
  { key: 'changes', label: 'Changes' },
  { key: 'worktrees', label: 'Worktrees' },
];

interface ProjectListItemProps {
  project: ProjectInfo;
  active: boolean;
  onSelect: (path: string) => void;
  groups: VisibleProjectGroup[];
  currentGroupId: string;
  menuOpen: boolean;
  onToggleMenu: (projectPath: string) => void;
  onAssignGroup: (projectPath: string, groupId: string) => void;
}

function shortenPath(fullPath: string) {
  const homePrefix = '/Users/';
  if (!fullPath.startsWith(homePrefix)) return fullPath;
  const segments = fullPath.split('/').filter(Boolean);
  if (segments.length < 3) return fullPath;
  return `.../${segments.slice(2).join('/')}`;
}

export default function ProjectListItem({
  project,
  active,
  onSelect,
  groups,
  currentGroupId,
  menuOpen,
  onToggleMenu,
  onAssignGroup,
}: ProjectListItemProps) {
  const { activeTab, setTab } = useSidebarStore();

  return (
    <div style={{ position: 'relative' }}>
      {/* 项目卡片 */}
      <div
        style={{
          width: '100%',
          border: 'none',
          borderRadius: active ? '18px 18px 0 0' : 18,
          background: active ? '#373a52' : '#2b2e43',
          color: '#eef0ff',
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
        }}
      >
        <button
          type="button"
          onClick={() => onSelect(project.path)}
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            padding: 0,
            textAlign: 'left',
            cursor: 'pointer',
          }}
          aria-label={`打开项目 ${project.name}`}
        >
          <span style={{ color: '#d4d8f5', marginTop: 2 }}>
            <FolderCode size={20} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span
              style={{
                display: 'block',
                fontSize: 16,
                fontWeight: 700,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {project.name}
            </span>
            <span
              style={{
                display: 'block',
                marginTop: 6,
                fontSize: 12,
                color: '#a0a5be',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {shortenPath(project.path)}
            </span>
          </span>
        </button>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            color: '#c7cadb',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: 24,
              height: 24,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-hidden="true"
          >
            <Plus size={16} />
          </span>
          <button
            type="button"
            aria-label={`管理项目 ${project.name}`}
            onClick={() => onToggleMenu(project.path)}
            style={{
              width: 28,
              height: 28,
              border: 'none',
              borderRadius: 999,
              background: menuOpen ? '#464c69' : 'transparent',
              color: '#c7cadb',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <SlidersHorizontal size={16} />
          </button>
        </span>
      </div>

      {/* 手风琴展开区：仅当前活跃项目展示 Files/Changes/Worktrees */}
      {active && (
        <div
          data-testid={`accordion-panel-${project.name}`}
          style={{
            background: '#1e2030',
            borderRadius: '0 0 18px 18px',
            overflow: 'hidden',
          }}
        >
          {/* 标签页导航 */}
          <div
            role="tablist"
            aria-label={`${project.name} 详情标签页`}
            style={{
              display: 'flex',
              borderBottom: '1px solid #27293d',
            }}
          >
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                role="tab"
                aria-selected={activeTab === key}
                onClick={() => setTab(key)}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: activeTab === key ? '2px solid #7aa2f7' : '2px solid transparent',
                  cursor: 'pointer',
                  color: activeTab === key ? '#c0caf5' : '#565f89',
                  fontSize: 11,
                  fontWeight: activeTab === key ? 600 : 400,
                  transition: 'color 0.15s, border-bottom-color 0.15s',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* 标签页内容 — 固定高度，内部滚动 */}
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {activeTab === 'files' && <FileTree />}
            {activeTab === 'changes' && <Changes />}
            {activeTab === 'worktrees' && <Worktrees />}
          </div>
        </div>
      )}

      {/* 分组菜单（保持不变） */}
      {menuOpen && (
        <div
          role="menu"
          aria-label={`${project.name} 分组菜单`}
          style={{
            position: 'absolute',
            top: 62,
            right: 10,
            zIndex: 20,
            minWidth: 188,
            borderRadius: 14,
            border: '1px solid #4b4f67',
            background: '#26293d',
            boxShadow: '0 12px 24px rgba(0,0,0,0.26)',
            overflow: 'hidden',
          }}
        >
          {groups
            .filter((group) => group.id !== 'all')
            .map((group, index) => (
              <button
                key={group.id}
                type="button"
                role="menuitem"
                aria-label={`移动到分组 ${group.name}`}
                onClick={() => onAssignGroup(project.path, group.id)}
                style={{
                  width: '100%',
                  border: 'none',
                  borderTop: index === 0 ? 'none' : '1px solid rgba(255,255,255,0.05)',
                  background: 'transparent',
                  color: '#eef0ff',
                  padding: '11px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <ProjectGroupIcon icon={group.icon} size={16} color="#eef0ff" />
                <span style={{ flex: 1, minWidth: 0 }}>{group.name}</span>
                <span style={{ color: currentGroupId === group.id ? '#8fc2ff' : '#6f748f' }}>
                  {currentGroupId === group.id ? '当前' : ''}
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/oi/CodeCoding/Code/自研项目/GhostTerm && pnpm tsc --noEmit`

Expected: compiles (aside from AddProjectDialog stub if not yet created).

- [ ] **Step 3: Commit**

```bash
git add src/features/sidebar/ProjectListItem.tsx
git commit -m "feat: add accordion Files/Changes/Worktrees tabs to ProjectListItem"
```

---

### Task 4: Update ProjectList — Remove maxHeight, Adjust Layout

**Files:**
- Modify: `src/features/sidebar/ProjectList.tsx`

Remove the `maxHeight: 280` constraint so the project list can grow with the scrollable parent. The accordion panels need room.

- [ ] **Step 1: Remove maxHeight from ProjectList container**

In `ProjectList.tsx`, change the container style:

```tsx
// 旧代码
overflowY: 'auto',
maxHeight: 280,

// 新代码 — 移除 maxHeight，滚动由 Sidebar 父容器处理
overflowY: 'visible',
```

The full updated return for non-empty case:

```tsx
return (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      padding: '0 12px 12px',
    }}
  >
    {projects.map((project) => (
      <ProjectListItem
        key={project.path}
        project={project}
        active={currentProjectPath === project.path}
        onSelect={onSelect}
        groups={groups}
        currentGroupId={projectGroupMap[project.path] ?? 'ungrouped'}
        menuOpen={openMenuProjectPath === project.path}
        onToggleMenu={onToggleMenu}
        onAssignGroup={onAssignGroup}
      />
    ))}
  </div>
);
```

- [ ] **Step 2: Commit**

```bash
git add src/features/sidebar/ProjectList.tsx
git commit -m "refactor: remove maxHeight from ProjectList, let parent scroll"
```

---

### Task 5: Clean Up ProjectSelector — Remove Bottom Stats Bar

**Files:**
- Modify: `src/features/sidebar/ProjectSelector.tsx`

Remove the "当前分组 X 个项目" + "打开文件夹" bottom bar (lines 203-232). The "打开文件夹" functionality moves to AddProjectDialog. The project count is already shown in ProjectGroupHeader.

- [ ] **Step 1: Remove the stats/open-folder section**

Remove the `FolderOpen` import and the entire `<div>` block at lines 203-232 (the one with "当前分组" text and "打开文件夹" button).

Also remove the `borderBottom` from the root container style since the selector now flows into the list without a bottom border separator.

Updated return (remove the stats div, keep everything else):

```tsx
return (
  <div
    style={{
      position: 'relative',
      background: '#2b2e43',
    }}
  >
    <ProjectGroupHeader ... />

    {menuOpen && <ProjectGroupMenu ... />}

    {editMenuOpen && currentGroup.id !== 'all' && ( ... )}

    <ProjectSearchBar value={searchQuery} onChange={setSearchQuery} />

    <ProjectList ... />
  </div>
);
```

Remove from imports: `FolderOpen` from lucide-react, `open as openDialog` from @tauri-apps/plugin-dialog.

Remove the `handleOpenFolder` function (lines 102-110).

- [ ] **Step 2: Verify build**

Run: `cd /Users/oi/CodeCoding/Code/自研项目/GhostTerm && pnpm tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/features/sidebar/ProjectSelector.tsx
git commit -m "refactor: remove bottom stats bar from ProjectSelector"
```

---

### Task 6: Create AddProjectDialog Component

**Files:**
- Create: `src/features/sidebar/AddProjectDialog.tsx`

Modal dialog matching the screenshot: title "添加仓库", three tabs (本地/克隆/SSH), directory input with browse button, group selector dropdown, cancel/add buttons.

- [ ] **Step 1: Create AddProjectDialog.tsx**

```tsx
/**
 * @file AddProjectDialog.tsx
 * @description 添加仓库弹窗 - 支持本地目录选择、克隆、SSH 三种方式添加项目。
 *              当前 MVP 仅实现"本地"模式，克隆和 SSH 显示占位提示。
 *              分组选择复用 projectGroupingStore 数据。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { useMemo, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { FolderOpen, Globe, Terminal, X } from 'lucide-react';
import { useProjectStore } from './projectStore';
import {
  buildVisibleGroups,
  useProjectGroupingStore,
} from './projectGroupingStore';
import ProjectGroupIcon from './ProjectGroupIcon';

type AddTab = 'local' | 'clone' | 'ssh';

const ADD_TABS: { key: AddTab; label: string; icon: typeof FolderOpen }[] = [
  { key: 'local', label: '本地', icon: FolderOpen },
  { key: 'clone', label: '克隆', icon: Globe },
  { key: 'ssh', label: 'SSH', icon: Terminal },
];

interface AddProjectDialogProps {
  onClose: () => void;
}

export default function AddProjectDialog({ onClose }: AddProjectDialogProps) {
  const [activeTab, setActiveTab] = useState<AddTab>('local');
  const [repoPath, setRepoPath] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('ungrouped');
  const [groupDropdownOpen, setGroupDropdownOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { switchProject, recentProjects } = useProjectStore();
  const { groups, projectGroupMap, assignProjectToGroup, createGroup } =
    useProjectGroupingStore();

  // 构建可见分组列表（排除"全部"，因为添加时必须指定具体分组或未分组）
  const visibleGroups = useMemo(
    () =>
      buildVisibleGroups(groups, recentProjects, projectGroupMap).filter(
        (g) => g.id !== 'all',
      ),
    [groups, recentProjects, projectGroupMap],
  );

  const currentGroup = visibleGroups.find((g) => g.id === selectedGroupId) ?? visibleGroups[0];

  /** 浏览本地目录 */
  const handleBrowse = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (selected) {
      setRepoPath(selected as string);
    }
  };

  /** 提交添加项目 */
  const handleSubmit = async () => {
    if (!repoPath.trim()) return;
    setSubmitting(true);
    try {
      await switchProject(repoPath.trim());
      // 分配到选定分组
      assignProjectToGroup(repoPath.trim(), selectedGroupId);
      onClose();
    } catch (err) {
      console.error('[AddProjectDialog] 添加项目失败:', err);
    } finally {
      setSubmitting(false);
    }
  };

  /** 新建分组（内联） */
  const handleCreateGroup = () => {
    const name = window.prompt('请输入分组名称');
    if (!name?.trim()) return;
    const group = createGroup(name);
    setSelectedGroupId(group.id);
    setGroupDropdownOpen(false);
  };

  return (
    // 遮罩层
    <div
      data-testid="add-project-dialog-overlay"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* 弹窗主体 — 阻止点击穿透到遮罩 */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 460,
          borderRadius: 16,
          background: '#1e2030',
          border: '1px solid #353852',
          boxShadow: '0 24px 48px rgba(0,0,0,0.4)',
          padding: '28px 32px 24px',
        }}
      >
        {/* 标题栏 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 8,
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#eef0ff' }}>
              添加仓库
            </h2>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: '#8e93ad' }}>
              Add a local repository, clone from Git, or bind a repository on an SSH host.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            style={{
              border: 'none',
              background: 'transparent',
              color: '#8e93ad',
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* 三 Tab 切换 */}
        <div
          style={{
            display: 'flex',
            marginTop: 16,
            marginBottom: 24,
            borderRadius: 10,
            overflow: 'hidden',
            border: '1px solid #353852',
          }}
        >
          {ADD_TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '10px 0',
                border: 'none',
                background: activeTab === key ? '#353852' : 'transparent',
                color: activeTab === key ? '#eef0ff' : '#8e93ad',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: activeTab === key ? 600 : 400,
              }}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {/* Tab 内容区 */}
        {activeTab === 'local' && (
          <div>
            {/* 仓库目录 */}
            <label
              style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 600,
                color: '#c0caf5',
                marginBottom: 8,
              }}
            >
              仓库目录
            </label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
              <input
                type="text"
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                placeholder="输入路径或从最近项目中选择..."
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid #353852',
                  background: '#16161e',
                  color: '#eef0ff',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={handleBrowse}
                style={{
                  padding: '10px 16px',
                  borderRadius: 10,
                  border: '1px solid #353852',
                  background: '#2b2e43',
                  color: '#eef0ff',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                浏览
              </button>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6f748f' }}>
              选择计算机上的本地目录。
            </p>
          </div>
        )}

        {activeTab === 'clone' && (
          <div style={{ padding: '20px 0', color: '#6f748f', fontSize: 13, textAlign: 'center' }}>
            克隆仓库功能即将推出
          </div>
        )}

        {activeTab === 'ssh' && (
          <div style={{ padding: '20px 0', color: '#6f748f', fontSize: 13, textAlign: 'center' }}>
            SSH 仓库绑定功能即将推出
          </div>
        )}

        {/* 分组选择 */}
        <div style={{ marginTop: 20, position: 'relative' }}>
          <label
            style={{
              display: 'block',
              fontSize: 13,
              fontWeight: 600,
              color: '#c0caf5',
              marginBottom: 8,
            }}
          >
            分组
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => setGroupDropdownOpen((v) => !v)}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid #353852',
                background: '#16161e',
                color: '#eef0ff',
                cursor: 'pointer',
                fontSize: 13,
                textAlign: 'left',
              }}
            >
              {currentGroup && (
                <>
                  <ProjectGroupIcon icon={currentGroup.icon} size={14} color={currentGroup.color} />
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: currentGroup.color,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ flex: 1 }}>{currentGroup.name}</span>
                </>
              )}
            </button>
            {/* 新建分组按钮 */}
            <button
              type="button"
              onClick={handleCreateGroup}
              aria-label="新建分组"
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                border: '1px solid #353852',
                background: '#2b2e43',
                color: '#8e93ad',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              +
            </button>
          </div>

          {/* 分组下拉列表 */}
          {groupDropdownOpen && (
            <div
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                right: 48,
                marginBottom: 4,
                borderRadius: 12,
                border: '1px solid #4b4f67',
                background: '#26293d',
                boxShadow: '0 12px 24px rgba(0,0,0,0.26)',
                overflow: 'hidden',
                zIndex: 10,
              }}
            >
              {visibleGroups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => {
                    setSelectedGroupId(group.id);
                    setGroupDropdownOpen(false);
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 12px',
                    border: 'none',
                    background: selectedGroupId === group.id ? '#353852' : 'transparent',
                    color: '#eef0ff',
                    cursor: 'pointer',
                    fontSize: 13,
                    textAlign: 'left',
                  }}
                >
                  <ProjectGroupIcon icon={group.icon} size={14} color={group.color} />
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: group.color,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ flex: 1 }}>{group.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 12,
            marginTop: 28,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '10px 24px',
              borderRadius: 10,
              border: '1px solid #353852',
              background: 'transparent',
              color: '#c0caf5',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !repoPath.trim()}
            style={{
              padding: '10px 24px',
              borderRadius: 10,
              border: 'none',
              background: repoPath.trim() ? '#5b8def' : '#3d4263',
              color: repoPath.trim() ? '#fff' : '#8e93ad',
              cursor: repoPath.trim() ? 'pointer' : 'not-allowed',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            添加
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/oi/CodeCoding/Code/自研项目/GhostTerm && pnpm tsc --noEmit`

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/features/sidebar/AddProjectDialog.tsx
git commit -m "feat: add AddProjectDialog with Local/Clone/SSH tabs and group selector"
```

---

### Task 7: Update Module Exports

**Files:**
- Modify: `src/features/sidebar/index.ts`

- [ ] **Step 1: Add new exports**

Add to `src/features/sidebar/index.ts`:

```ts
export { default as AddProjectButton } from './AddProjectButton';
export { default as AddProjectDialog } from './AddProjectDialog';
```

- [ ] **Step 2: Full build + dev server test**

Run: `cd /Users/oi/CodeCoding/Code/自研项目/GhostTerm && pnpm tsc --noEmit`

Expected: PASS — all imports resolve, no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/sidebar/index.ts
git commit -m "chore: export AddProjectButton and AddProjectDialog from sidebar module"
```

---

### Task 8: Integration Test — Visual Verification

- [ ] **Step 1: Start the dev server**

Run: `cd /Users/oi/CodeCoding/Code/自研项目/GhostTerm && pnpm tauri dev`

- [ ] **Step 2: Verify accordion behavior**

1. Click a project in the sidebar → Files/Changes/Worktrees tabs appear below it
2. Click a different project → previous project's tabs collapse, new project's tabs appear
3. Switch between Files/Changes/Worktrees tabs within the expanded project
4. Scroll the project list when many projects exist

- [ ] **Step 3: Verify AddProject dialog**

1. Click the "+ 添加项目" button at sidebar bottom
2. Dialog opens with "添加仓库" title
3. Three tabs visible: 本地 / 克隆 / SSH
4. "本地" tab: directory input + browse button works (opens native file picker)
5. Group selector dropdown shows existing groups
6. "+" button next to group selector creates a new group
7. "取消" closes the dialog
8. "添加" with a valid path opens the project and assigns it to selected group

- [ ] **Step 4: Commit all remaining changes**

```bash
git add -A
git commit -m "feat: sidebar accordion pattern with per-project tabs and add-project dialog"
```
