/**
 * @file AddProjectDialog.tsx
 * @description 添加仓库弹窗组件 - 支持本地目录打开、Git URL 克隆、SSH URL 克隆，并可选择分组。
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { FolderOpen, Globe, Terminal, X, ChevronDown } from 'lucide-react';
import { useProjectStore } from './projectStore';
import { buildVisibleGroups, useProjectGroupingStore } from './projectGroupingStore';
import ProjectGroupIcon from './ProjectGroupIcon';
import { useSidebarUiStore } from './sidebarUiStore';

interface AddProjectDialogProps {
  onClose: () => void;
}

type TabId = 'local' | 'clone' | 'ssh';

function fieldLabelStyle(): CSSProperties {
  return {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: '#c0caf5',
    marginBottom: 8,
  };
}

function inputStyle(): CSSProperties {
  return {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid #353852',
    background: '#16161e',
    color: '#eef0ff',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box',
  };
}

export default function AddProjectDialog({ onClose }: AddProjectDialogProps) {
  const [activeTab, setActiveTab] = useState<TabId>('local');
  const [localPath, setLocalPath] = useState('');
  const [cloneUrl, setCloneUrl] = useState('');
  const [clonePath, setClonePath] = useState('');
  const [sshUrl, setSshUrl] = useState('');
  const [sshPath, setSshPath] = useState('');
  const [groupDropdownOpen, setGroupDropdownOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { switchProject } = useProjectStore();
  const dialogGroupId = useSidebarUiStore((s) => s.addProjectDialogGroupId);
  const {
    groups,
    projectGroupMap,
    createGroup,
    assignProjectToGroup,
    selectedGroupId: storeSelectedGroupId,
  } = useProjectGroupingStore();

  const defaultGroupId =
    dialogGroupId ?? (storeSelectedGroupId === 'all' ? 'ungrouped' : storeSelectedGroupId);
  const [selectedGroupId, setSelectedGroupId] = useState(defaultGroupId);

  const allVisibleGroups = useMemo(
    () => buildVisibleGroups(groups, [], projectGroupMap),
    [groups, projectGroupMap],
  );
  const selectableGroups = allVisibleGroups.filter((group) => group.id !== 'all');
  const selectedGroup = selectableGroups.find((group) => group.id === selectedGroupId) ?? selectableGroups[0];

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, submitting]);

  const tabStyle = (tabId: TabId): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 14px',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
    color: activeTab === tabId ? '#eef0ff' : '#6f748f',
    background: activeTab === tabId ? '#353852' : 'transparent',
    border: 'none',
    outline: 'none',
    transition: 'background 0.15s, color 0.15s',
    whiteSpace: 'nowrap',
  });

  const browseDirectory = async (setter: (value: string) => void) => {
    try {
      const result = await openDialog({ directory: true, multiple: false });
      if (typeof result === 'string') {
        setter(result);
        setErrorMessage('');
      }
    } catch (error) {
      setErrorMessage(`选择目录失败：${String(error)}`);
    }
  };

  const handleCreateGroup = () => {
    const name = window.prompt('请输入新分组名称');
    if (!name?.trim()) return;
    const nextGroup = createGroup(name.trim());
    setSelectedGroupId(nextGroup.id);
    setGroupDropdownOpen(false);
  };

  const getSubmitPayload = () => {
    if (activeTab === 'local') {
      const path = localPath.trim();
      if (!path) return null;
      return { type: 'local' as const, openPath: path };
    }

    if (activeTab === 'clone') {
      const repositoryUrl = cloneUrl.trim();
      const destinationPath = clonePath.trim();
      if (!repositoryUrl || !destinationPath) return null;
      return { type: 'clone' as const, repositoryUrl, destinationPath, openPath: destinationPath };
    }

    const repositoryUrl = sshUrl.trim();
    const destinationPath = sshPath.trim();
    if (!repositoryUrl || !destinationPath) return null;
    return { type: 'clone' as const, repositoryUrl, destinationPath, openPath: destinationPath };
  };

  const submitPayload = getSubmitPayload();

  const handleSubmit = async () => {
    if (!submitPayload || submitting || !selectedGroup) return;

    setSubmitting(true);
    setErrorMessage('');

    try {
      if (submitPayload.type === 'clone') {
        await invoke('clone_repository_cmd', {
          repositoryUrl: submitPayload.repositoryUrl,
          destinationPath: submitPayload.destinationPath,
        });
      }

      await switchProject(submitPayload.openPath);
      assignProjectToGroup(submitPayload.openPath, selectedGroup.id);
      onClose();
    } catch (error) {
      setErrorMessage(String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      onClick={() => !submitting && onClose()}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      data-testid="add-project-dialog-overlay"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 500,
          borderRadius: 16,
          background: '#1e2030',
          border: '1px solid #353852',
          padding: '28px 32px 24px',
          position: 'relative',
          boxSizing: 'border-box',
          boxShadow: '0 22px 50px rgba(0,0,0,0.35)',
        }}
        data-testid="add-project-dialog"
      >
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#eef0ff' }}>添加项目</h2>
              <p style={{ margin: '6px 0 0', fontSize: 12, color: '#6f748f', lineHeight: 1.5 }}>
                打开本地仓库，或克隆一个新的 Git 仓库后自动加入当前侧边栏。
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              aria-label="关闭添加项目对话框"
              style={{
                background: 'none',
                border: 'none',
                cursor: submitting ? 'default' : 'pointer',
                color: '#6f748f',
                padding: 4,
                display: 'flex',
                alignItems: 'center',
                marginTop: -2,
              }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div
          style={{
            display: 'inline-flex',
            borderRadius: 10,
            border: '1px solid #353852',
            padding: 3,
            marginBottom: 20,
          }}
        >
          <button type="button" style={tabStyle('local')} onClick={() => setActiveTab('local')}>
            <FolderOpen size={14} />
            本地
          </button>
          <button type="button" style={tabStyle('clone')} onClick={() => setActiveTab('clone')}>
            <Globe size={14} />
            克隆
          </button>
          <button type="button" style={tabStyle('ssh')} onClick={() => setActiveTab('ssh')}>
            <Terminal size={14} />
            SSH
          </button>
        </div>

        <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {activeTab === 'local' && (
            <>
              <div>
                <label style={fieldLabelStyle()}>仓库目录</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    value={localPath}
                    onChange={(event) => setLocalPath(event.target.value)}
                    placeholder="/path/to/repository"
                    style={{ ...inputStyle(), flex: 1 }}
                    data-testid="add-project-local-path-input"
                  />
                  <button
                    type="button"
                    onClick={() => browseDirectory(setLocalPath)}
                    style={{
                      padding: '10px 16px',
                      borderRadius: 10,
                      border: '1px solid #353852',
                      background: '#2b2e43',
                      color: '#eef0ff',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    浏览
                  </button>
                </div>
              </div>
              <p style={{ margin: 0, fontSize: 12, color: '#6f748f' }}>选择一个已经存在的本地 Git 仓库目录。</p>
            </>
          )}

          {activeTab === 'clone' && (
            <>
              <div>
                <label style={fieldLabelStyle()}>仓库 URL</label>
                <input
                  type="text"
                  value={cloneUrl}
                  onChange={(event) => setCloneUrl(event.target.value)}
                  placeholder="https://github.com/org/repo.git"
                  style={inputStyle()}
                  data-testid="add-project-clone-url-input"
                />
              </div>
              <div>
                <label style={fieldLabelStyle()}>克隆到目录</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    value={clonePath}
                    onChange={(event) => setClonePath(event.target.value)}
                    placeholder="/absolute/path/to/new-project"
                    style={{ ...inputStyle(), flex: 1 }}
                    data-testid="add-project-clone-path-input"
                  />
                  <button
                    type="button"
                    onClick={() => browseDirectory(setClonePath)}
                    style={{
                      padding: '10px 16px',
                      borderRadius: 10,
                      border: '1px solid #353852',
                      background: '#2b2e43',
                      color: '#eef0ff',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    浏览
                  </button>
                </div>
              </div>
              <p style={{ margin: 0, fontSize: 12, color: '#6f748f' }}>支持 HTTPS 或任意 Git 可识别的远程地址。</p>
            </>
          )}

          {activeTab === 'ssh' && (
            <>
              <div>
                <label style={fieldLabelStyle()}>SSH 仓库地址</label>
                <input
                  type="text"
                  value={sshUrl}
                  onChange={(event) => setSshUrl(event.target.value)}
                  placeholder="git@github.com:org/repo.git"
                  style={inputStyle()}
                  data-testid="add-project-ssh-url-input"
                />
              </div>
              <div>
                <label style={fieldLabelStyle()}>克隆到目录</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    value={sshPath}
                    onChange={(event) => setSshPath(event.target.value)}
                    placeholder="/absolute/path/to/new-project"
                    style={{ ...inputStyle(), flex: 1 }}
                    data-testid="add-project-ssh-path-input"
                  />
                  <button
                    type="button"
                    onClick={() => browseDirectory(setSshPath)}
                    style={{
                      padding: '10px 16px',
                      borderRadius: 10,
                      border: '1px solid #353852',
                      background: '#2b2e43',
                      color: '#eef0ff',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    浏览
                  </button>
                </div>
              </div>
              <p style={{ margin: 0, fontSize: 12, color: '#6f748f' }}>用于明确使用 SSH 地址克隆仓库。</p>
            </>
          )}
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={fieldLabelStyle()}>分组</label>
          <div style={{ display: 'flex', gap: 8, position: 'relative' }}>
            <button
              type="button"
              onClick={() => setGroupDropdownOpen((value) => !value)}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid #353852',
                background: '#2b2e43',
                color: '#eef0ff',
                fontSize: 13,
                cursor: 'pointer',
                textAlign: 'left',
              }}
              data-testid="add-project-group-select"
            >
              {selectedGroup && (
                <>
                  <ProjectGroupIcon icon={selectedGroup.icon} size={14} color={selectedGroup.color} />
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: selectedGroup.color,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>{selectedGroup.name}</span>
                  <ChevronDown size={14} />
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleCreateGroup}
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                border: '1px solid #353852',
                background: '#2b2e43',
                color: '#eef0ff',
                fontSize: 18,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
              aria-label="新建分组"
            >
              +
            </button>

            {groupDropdownOpen && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: 0,
                  right: 48,
                  marginBottom: 4,
                  borderRadius: 10,
                  border: '1px solid #353852',
                  background: '#1e2030',
                  overflow: 'hidden',
                  zIndex: 100,
                }}
              >
                {selectableGroups.map((group) => (
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
                      padding: '9px 12px',
                      background: group.id === selectedGroupId ? '#353852' : 'transparent',
                      border: 'none',
                      color: '#eef0ff',
                      fontSize: 13,
                      cursor: 'pointer',
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
                    <span style={{ flex: 1, minWidth: 0 }}>{group.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {errorMessage && (
          <div
            style={{
              marginBottom: 16,
              padding: '10px 12px',
              borderRadius: 10,
              background: 'rgba(247, 118, 142, 0.12)',
              color: '#f29ba1',
              fontSize: 12,
              lineHeight: 1.5,
            }}
            data-testid="add-project-error"
          >
            {errorMessage}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              padding: '10px 24px',
              borderRadius: 10,
              border: '1px solid #353852',
              background: 'transparent',
              color: '#eef0ff',
              fontSize: 13,
              fontWeight: 500,
              cursor: submitting ? 'default' : 'pointer',
            }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!submitPayload || submitting}
            style={{
              padding: '10px 24px',
              borderRadius: 10,
              border: 'none',
              background: submitPayload && !submitting ? '#5b8def' : '#3d4263',
              color: '#eef0ff',
              fontSize: 13,
              fontWeight: 600,
              cursor: submitPayload && !submitting ? 'pointer' : 'default',
            }}
            data-testid="add-project-submit"
          >
            {submitting ? '处理中…' : activeTab === 'local' ? '打开项目' : '克隆并打开'}
          </button>
        </div>
      </div>
    </div>
  );
}
