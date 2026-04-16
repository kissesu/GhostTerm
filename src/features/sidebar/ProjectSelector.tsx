/**
 * @file ProjectSelector.tsx
 * @description 左侧项目区容器 - 以“分组后的项目列表”为中心，负责分组切换、搜索和项目列表。
 *              不再使用旧的最近项目下拉模型。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from './projectStore';
import ProjectGroupHeader from './ProjectGroupHeader';
import ProjectGroupMenu from './ProjectGroupMenu';
import ProjectList from './ProjectList';
import ProjectSearchBar from './ProjectSearchBar';
import SidebarDialog, { dialogButtonStyle, dialogInputStyle } from './SidebarDialog';
import {
  buildVisibleGroups,
  filterProjectsByGrouping,
  SYSTEM_GROUP_ALL,
  useProjectGroupingStore,
} from './projectGroupingStore';

function findCurrentGroup(groupId: string, groups: ReturnType<typeof buildVisibleGroups>) {
  return groups.find((group) => group.id === groupId) ?? { ...SYSTEM_GROUP_ALL, projectCount: 0 };
}

type GroupDialogMode = 'create' | 'rename' | 'delete' | null;

export default function ProjectSelector() {
  const { currentProject, recentProjects, switchProject, removeProject } = useProjectStore();
  const {
    groups,
    systemGroupNames,
    selectedGroupId,
    projectGroupMap,
    searchQuery,
    selectGroup,
    setSearchQuery,
    createGroup,
    renameGroup,
    deleteGroup,
    assignProjectToGroup,
  } = useProjectGroupingStore();

  const [menuOpen, setMenuOpen] = useState(false);
  // 当前活跃项目手风琴是否收起（点击已激活的项目名可切换）
  const [accordionCollapsed, setAccordionCollapsed] = useState(false);
  const [editMenuOpen, setEditMenuOpen] = useState(false);
  const [projectMenuPath, setProjectMenuPath] = useState<string>();
  const [groupDialogMode, setGroupDialogMode] = useState<GroupDialogMode>(null);
  const [groupNameInput, setGroupNameInput] = useState('');
  const [groupNameError, setGroupNameError] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const groupMenuRef = useRef<HTMLDivElement>(null);
  const editMenuRef = useRef<HTMLDivElement>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const pendingScrollRestoreRef = useRef<{ offsetTop: number } | null>(null);

  const visibleGroups = useMemo(
    () => buildVisibleGroups(groups, recentProjects, projectGroupMap, systemGroupNames),
    [groups, recentProjects, projectGroupMap, systemGroupNames],
  );

  // 侧边栏导航：当"未分组"没有项目时隐藏，避免初始化时出现空的默认分组
  // ProjectList 仍使用完整 visibleGroups（含 ungrouped），保留分配选项
  const navGroups = useMemo(
    () => visibleGroups.filter((g) => g.id !== 'ungrouped' || g.projectCount > 0),
    [visibleGroups],
  );

  const currentGroup = findCurrentGroup(selectedGroupId, visibleGroups);
  const filteredProjects = useMemo(
    () =>
      filterProjectsByGrouping(recentProjects, {
        selectedGroupId,
        searchQuery,
        projectGroupMap,
      }),
    [recentProjects, selectedGroupId, searchQuery, projectGroupMap],
  );

  const handleSelectProject = async (path: string) => {
    if (path === currentProject?.path) {
      // 点击当前已激活的项目：收缩/展开手风琴，不重新打开
      setAccordionCollapsed((prev) => !prev);
      setMenuOpen(false);
      setEditMenuOpen(false);
      setProjectMenuPath(undefined);
      return;
    }
    // 切换到新项目时，默认展开手风琴
    setAccordionCollapsed(false);

    const nextProject = recentProjects.find((item) => item.path === path);
    const container = listScrollRef.current;
    const targetCard = nextProject
      ? container?.querySelector<HTMLElement>(`[data-testid="project-card-${nextProject.name}"]`)
      : null;
    const containerRect = container?.getBoundingClientRect();
    const targetRect = targetCard?.getBoundingClientRect();
    pendingScrollRestoreRef.current =
      container && containerRect && targetRect
        ? {
            offsetTop: targetRect.top - containerRect.top,
          }
        : null;
    setMenuOpen(false);
    setEditMenuOpen(false);
    setProjectMenuPath(undefined);
    try {
      await switchProject(path);
    } catch (err) {
      console.error('[ProjectSelector] 切换项目失败:', err);
    }
  };

  useEffect(() => {
    const pendingRestore = pendingScrollRestoreRef.current;
    const container = listScrollRef.current;
    if (!pendingRestore || !container) {
      return;
    }

    pendingScrollRestoreRef.current = null;

    requestAnimationFrame(() => {
      const targetCard = container.querySelector<HTMLElement>(`[data-testid="project-card-${currentProject?.name}"]`);
      const containerRect = container.getBoundingClientRect();
      const targetRect = targetCard?.getBoundingClientRect();
      if (!targetRect) {
        return;
      }

      const nextOffsetTop = targetRect.top - containerRect.top;
      container.scrollTop += nextOffsetTop - pendingRestore.offsetTop;
    });
  }, [currentProject?.path, currentProject?.name]);

  useEffect(() => {
    if (!menuOpen && !editMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedInsideRoot = rootRef.current?.contains(target) ?? false;
      const clickedInsideGroupMenu = groupMenuRef.current?.contains(target) ?? false;
      const clickedInsideEditMenu = editMenuRef.current?.contains(target) ?? false;

      if (!clickedInsideRoot && !clickedInsideGroupMenu && !clickedInsideEditMenu) {
        setMenuOpen(false);
        setEditMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        setEditMenuOpen(false);
        setProjectMenuPath(undefined);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen, editMenuOpen]);

  const handleAssignProjectGroup = (projectPath: string, groupId: string) => {
    assignProjectToGroup(projectPath, groupId);
    setProjectMenuPath(undefined);
  };

  const handleRemoveProject = async (projectPath: string) => {
    setProjectMenuPath(undefined);
    try {
      await removeProject(projectPath);
    } catch (err) {
      console.error('[ProjectSelector] 移除项目失败:', err);
    }
  };

  const closeGroupDialog = () => {
    setGroupDialogMode(null);
    setGroupNameInput('');
    setGroupNameError('');
  };

  const openCreateGroupDialog = () => {
    setMenuOpen(false);
    setEditMenuOpen(false);
    setProjectMenuPath(undefined);
    setGroupNameInput('');
    setGroupDialogMode('create');
  };

  const openRenameGroupDialog = () => {
    if (currentGroup.id === 'all') return;
    setEditMenuOpen(false);
    setMenuOpen(false);
    setProjectMenuPath(undefined);
    setGroupNameInput(currentGroup.name);
    setGroupDialogMode('rename');
  };

  const openDeleteGroupDialog = () => {
    if (currentGroup.id === 'all' || currentGroup.id === 'ungrouped') return;
    setEditMenuOpen(false);
    setMenuOpen(false);
    setProjectMenuPath(undefined);
    setGroupDialogMode('delete');
  };

  const submitCreateGroup = () => {
    const name = groupNameInput.trim();
    if (!name) return;
    try {
      createGroup(name);
      closeGroupDialog();
    } catch (err) {
      setGroupNameError(String(err instanceof Error ? err.message : err));
    }
  };

  const submitRenameGroup = () => {
    const name = groupNameInput.trim();
    if (!name || currentGroup.id === 'all') return;
    try {
      renameGroup(currentGroup.id, name);
      closeGroupDialog();
    } catch (err) {
      setGroupNameError(String(err instanceof Error ? err.message : err));
    }
  };

  const submitDeleteGroup = () => {
    if (currentGroup.id === 'all' || currentGroup.id === 'ungrouped') return;
    deleteGroup(currentGroup.id);
    closeGroupDialog();
  };

  return (
    <div
      style={{
        position: 'relative',
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--c-panel)',
      }}
    >
      {/* 顶部固定区：分组头 + 搜索栏（flexShrink:0 确保不被压缩） */}
      <div ref={rootRef}>
        <ProjectGroupHeader
          currentGroup={currentGroup}
          menuOpen={menuOpen}
          onToggleMenu={() => {
            setMenuOpen((value) => !value);
            setEditMenuOpen(false);
            setProjectMenuPath(undefined);
          }}
          onToggleEditMenu={() => {
            if (currentGroup.id === 'all') return;
            setEditMenuOpen((value) => !value);
            setMenuOpen(false);
            setProjectMenuPath(undefined);
          }}
          canEdit={currentGroup.id !== 'all'}
        />
      </div>

      {menuOpen && (
        <div ref={groupMenuRef}>
          <ProjectGroupMenu
            groups={navGroups}
            selectedGroupId={selectedGroupId}
            onSelectGroup={(groupId) => {
              selectGroup(groupId);
              setMenuOpen(false);
              setProjectMenuPath(undefined);
            }}
            onCreateGroup={openCreateGroupDialog}
          />
        </div>
      )}

      {editMenuOpen && currentGroup.id !== 'all' && (
        <div
          ref={editMenuRef}
          style={{
            position: 'absolute',
            top: 54,
            right: 8,
            zIndex: 41,
            width: 150,
            borderRadius: 'var(--r-lg)',
            border: '1px solid var(--c-border)',
            background: 'var(--c-overlay)',
            boxShadow: 'var(--shadow-menu)',
            overflow: 'hidden',
          }}
        >
          <button
            type="button"
            onClick={openRenameGroupDialog}
            style={{
              width: '100%',
              border: 'none',
              background: 'transparent',
              color: 'var(--c-fg)',
              textAlign: 'left',
              padding: '12px 14px',
              cursor: 'pointer',
            }}
          >
            重命名分组
          </button>
          {currentGroup.id !== 'ungrouped' && (
            <button
              type="button"
              onClick={openDeleteGroupDialog}
              style={{
                width: '100%',
                border: 'none',
                borderTop: '1px solid var(--c-border-sub)',
                background: 'transparent',
                color: 'var(--c-danger)',
                textAlign: 'left',
                padding: '12px 14px',
                cursor: 'pointer',
              }}
            >
              删除分组
            </button>
          )}
        </div>
      )}

      <ProjectSearchBar value={searchQuery} onChange={setSearchQuery} />

      {/* 项目列表滚动区：flex:1 占满剩余空间，minHeight:0 允许收缩，overflowY:auto 独立滚动 */}
      <div
        ref={listScrollRef}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowAnchor: 'none' }}
        data-testid="project-list-scroll-container"
      >
      <ProjectList
        projects={filteredProjects}
        currentProjectPath={currentProject?.path}
        accordionCollapsed={accordionCollapsed}
        onSelect={handleSelectProject}
        onRemove={handleRemoveProject}
        groups={visibleGroups}
        projectGroupMap={projectGroupMap}
        openMenuProjectPath={projectMenuPath}
        onToggleMenu={(projectPath) => {
          setMenuOpen(false);
          setEditMenuOpen(false);
          setProjectMenuPath((currentPath) => (currentPath === projectPath ? undefined : projectPath));
        }}
        onAssignGroup={handleAssignProjectGroup}
      />
      </div>

      {groupDialogMode === 'create' && (
        <SidebarDialog
          title="新建分组"
          description="创建一个新的项目分组，用于整理侧边栏中的项目列表。"
          onClose={closeGroupDialog}
          footer={(
            <>
              <button type="button" onClick={closeGroupDialog} style={{ ...dialogButtonStyle(), padding: '9px 14px', borderRadius: 10 }}>
                取消
              </button>
              <button type="button" onClick={submitCreateGroup} disabled={!groupNameInput.trim()} style={{ ...dialogButtonStyle('primary'), padding: '9px 14px', borderRadius: 10, opacity: groupNameInput.trim() ? 1 : 0.55, cursor: groupNameInput.trim() ? 'pointer' : 'not-allowed' }} data-testid="group-create-confirm">
                创建
              </button>
            </>
          )}
          testId="group-create-dialog"
        >
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--c-fg)', marginBottom: 8 }}>
            分组名称
          </label>
          <input
            autoFocus
            type="text"
            value={groupNameInput}
            onChange={(event) => { setGroupNameInput(event.target.value); setGroupNameError(''); }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && groupNameInput.trim()) {
                submitCreateGroup();
              }
            }}
            placeholder="例如：客户端 / 毕设 / 临时实验"
            style={dialogInputStyle()}
            data-testid="group-name-input"
          />
          {groupNameError && (
            <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--c-danger)' }}>{groupNameError}</p>
          )}
        </SidebarDialog>
      )}

      {groupDialogMode === 'rename' && currentGroup.id !== 'all' && (
        <SidebarDialog
          title="重命名分组"
          description={`当前分组：${currentGroup.name}`}
          onClose={closeGroupDialog}
          footer={(
            <>
              <button type="button" onClick={closeGroupDialog} style={{ ...dialogButtonStyle(), padding: '9px 14px', borderRadius: 10 }}>
                取消
              </button>
              <button type="button" onClick={submitRenameGroup} disabled={!groupNameInput.trim()} style={{ ...dialogButtonStyle('primary'), padding: '9px 14px', borderRadius: 10, opacity: groupNameInput.trim() ? 1 : 0.55, cursor: groupNameInput.trim() ? 'pointer' : 'not-allowed' }} data-testid="group-rename-confirm">
                保存
              </button>
            </>
          )}
          testId="group-rename-dialog"
        >
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--c-fg)', marginBottom: 8 }}>
            新名称
          </label>
          <input
            autoFocus
            type="text"
            value={groupNameInput}
            onChange={(event) => { setGroupNameInput(event.target.value); setGroupNameError(''); }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && groupNameInput.trim()) {
                submitRenameGroup();
              }
            }}
            style={dialogInputStyle()}
            data-testid="group-rename-input"
          />
          {groupNameError && (
            <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--c-danger)' }}>{groupNameError}</p>
          )}
        </SidebarDialog>
      )}

      {groupDialogMode === 'delete' && currentGroup.id !== 'all' && currentGroup.id !== 'ungrouped' && (
        <SidebarDialog
          title="删除分组"
          description={<>确认删除分组 “{currentGroup.name}”？<br />该分组下的项目会回到“未分组”。</>}
          onClose={closeGroupDialog}
          footer={(
            <>
              <button type="button" onClick={closeGroupDialog} style={{ ...dialogButtonStyle(), padding: '9px 14px', borderRadius: 10 }}>
                取消
              </button>
              <button type="button" onClick={submitDeleteGroup} style={{ ...dialogButtonStyle('danger'), padding: '9px 14px', borderRadius: 10 }} data-testid="group-delete-confirm">
                删除
              </button>
            </>
          )}
          testId="group-delete-dialog"
        />
      )}
    </div>
  );
}
