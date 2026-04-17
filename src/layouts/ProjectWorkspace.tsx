/**
 * @file ProjectWorkspace.tsx
 * @description "项目" Tab 的 workspace：侧边栏 + 编辑器 + 终端 三面板
 * @author Atlas.oi
 * @date 2026-04-17
 */

import React from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { Sidebar, useProjectStore } from '../features/sidebar';
import { Editor, EditorTabs } from '../features/editor';
import { Terminal, useTerminalStore } from '../features/terminal';

/** 终端面板工具栏右侧操作按钮 */
function TerminalAction({
  onClick, label, title, children,
  danger = false,
}: {
  onClick: () => void;
  label: string;
  title: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={title}
      className={`btn-icon${danger ? ' btn-icon-danger' : ''}`}
      style={{ width: 26, height: 26 }}
    >
      {children}
    </button>
  );
}

interface ProjectWorkspaceProps {
  sidebarVisible: boolean;
}

/**
 * 项目工作区：三栏分屏布局
 *
 * 布局结构：
 * 1. 左侧面板（侧边栏）- 项目选择器 + Files/Changes/Worktrees
 * 2. 中间面板（编辑器）- EditorTabs + CodeMirror 6
 * 3. 右侧面板（终端）- xterm.js + WebSocket
 */
export function ProjectWorkspace({ sidebarVisible }: ProjectWorkspaceProps) {
  const activeProjectPath = useProjectStore((s) => s.currentProject?.path ?? null);
  const activeProjectName = useProjectStore((s) => s.currentProject?.name ?? null);
  const sessions = useTerminalStore((s) => s.sessions);
  const activateProject = useTerminalStore((s) => s.activateProject);
  const killProject = useTerminalStore((s) => s.killProject);

  const activeSession = activeProjectPath ? sessions[activeProjectPath] : null;

  return (
    <PanelGroup direction="horizontal" style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
      {/* 左侧面板 */}
      {sidebarVisible && (
        <>
          <Panel
            defaultSize={20}
            minSize={10}
            maxSize={40}
            style={{ background: 'var(--c-bg)', overflow: 'hidden', minWidth: 0, minHeight: 0 }}
          >
            <Sidebar />
          </Panel>
          <PanelResizeHandle
            style={{ width: 1, background: 'var(--c-border-sub)', cursor: 'col-resize' }}
          />
        </>
      )}

      {/* 中间面板 — 编辑器 */}
      <Panel
        defaultSize={50}
        minSize={20}
        style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}
      >
        <EditorTabs />
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
          <Editor />
        </div>
      </Panel>

      <PanelResizeHandle
        style={{ width: 1, background: 'var(--c-border-sub)', cursor: 'col-resize' }}
      />

      {/* 右侧面板 — 终端 */}
      <Panel
        defaultSize={30}
        minSize={15}
        style={{ overflow: 'hidden', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      >
        {/* 终端工具栏 */}
        <div
          style={{
            height: 36,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            padding: '0 10px',
            background: 'var(--c-bg)',
            borderBottom: '1px solid var(--c-border-sub)',
            gap: 6,
          }}
        >
          {/* 终端图标 + 标签 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ flexShrink: 0, color: 'var(--c-fg-subtle)' }}>
              <path d="M2 4l5 4-5 4M9 12h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: 'var(--c-fg-subtle)',
              flexShrink: 0,
              userSelect: 'none',
            }}>
              终端
            </span>

            {/* 当前项目名 + 会话状态指示 */}
            {activeProjectName && (
              <>
                <span style={{ color: 'var(--c-border)', fontSize: 11 }}>/</span>
                <span style={{
                  fontSize: 12,
                  color: 'var(--c-fg-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  userSelect: 'none',
                }}>
                  {activeProjectName}
                </span>
                {/* 会话存活指示点 */}
                <span style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: activeSession ? 'var(--c-success)' : 'var(--c-fg-subtle)',
                  flexShrink: 0,
                  transition: 'background var(--dur-base) var(--ease-out)',
                }} />
              </>
            )}
          </div>

          {/* 重启 / 关闭按钮 */}
          {activeProjectPath && activeSession && (
            <>
              <TerminalAction
                onClick={() => {
                  useTerminalStore.getState().spawnForProject(activeProjectPath, activeProjectPath)
                    .catch(() => {});
                }}
                label="重启终端"
                title="重启终端"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M13.65 2.35A8 8 0 1 0 15 8h-2a6 6 0 1 1-1.1-3.45l-1.4 1.4V2h4v4l-1.85-1.65Z" fill="currentColor" />
                </svg>
              </TerminalAction>

              <TerminalAction
                onClick={() => killProject(activeProjectPath)}
                label="关闭终端"
                title="关闭终端"
                danger
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                  <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </TerminalAction>
            </>
          )}
        </div>

        {/* 占位：无活跃项目 */}
        {!activeProjectPath && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 10, color: 'var(--c-fg-subtle)', background: 'var(--c-bg)',
          }}>
            <svg width="28" height="28" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ opacity: 0.35 }}>
              <path d="M2 4l5 4-5 4M9 12h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span style={{ fontSize: 12 }}>打开项目后启动终端</span>
          </div>
        )}

        {/* 占位：有项目但无 PTY session */}
        {activeProjectPath && !activeSession && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 16, background: 'var(--c-bg)',
          }}>
            <svg width="28" height="28" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ color: 'var(--c-fg-subtle)', opacity: 0.4 }}>
              <path d="M2 4l5 4-5 4M9 12h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span style={{ fontSize: 12, color: 'var(--c-fg-subtle)' }}>终端已关闭</span>
            <button
              onClick={() => activateProject(activeProjectPath)}
              data-testid="start-terminal-button"
              aria-label="启动终端"
              style={{
                padding: '7px 20px',
                background: 'var(--c-accent)',
                color: 'var(--c-accent-text)',
                border: 'none',
                borderRadius: 'var(--r-md)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                fontFamily: 'var(--font-ui)',
                letterSpacing: '0.01em',
                transition: 'opacity var(--dur-fast) var(--ease-out)',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.88'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
            >
              启动终端
            </button>
          </div>
        )}

        {/* 所有项目的终端实例（display:none/flex 切换保留 scrollback） */}
        {Object.keys(sessions).map((path) => (
          <div
            key={path}
            data-testid={`terminal-wrapper-${path}`}
            style={{
              display: path === activeProjectPath ? 'flex' : 'none',
              flex: 1, minWidth: 0, minHeight: 0,
            }}
          >
            <Terminal projectPath={path} />
          </div>
        ))}
      </Panel>
    </PanelGroup>
  );
}
