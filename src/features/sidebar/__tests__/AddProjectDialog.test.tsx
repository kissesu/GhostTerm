import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import AddProjectDialog from '../AddProjectDialog';
import { useProjectStore } from '../projectStore';
import { useProjectGroupingStore } from '../projectGroupingStore';
import { useSidebarUiStore } from '../sidebarUiStore';

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

const mockInvoke = vi.mocked(invoke);
const onClose = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  onClose.mockReset();
  useSidebarUiStore.setState({
    addProjectDialogOpen: true,
    addProjectDialogGroupId: 'ungrouped',
  });
  useProjectStore.setState((state) => ({
    ...state,
    currentProject: null,
    recentProjects: [],
    switchProject: vi.fn().mockResolvedValue(undefined),
  }));
  useProjectGroupingStore.setState({
    groups: [],
    selectedGroupId: 'all',
    projectGroupMap: {},
    searchQuery: '',
  });
});

describe('AddProjectDialog', () => {
  it('本地模式提交应打开项目并写入分组映射', async () => {
    const user = userEvent.setup();
    const switchProject = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState((state) => ({ ...state, switchProject }));

    render(<AddProjectDialog onClose={onClose} />);
    await user.type(screen.getByTestId('add-project-local-path-input'), '/tmp/demo');
    await user.click(screen.getByTestId('add-project-submit'));

    await waitFor(() => {
      expect(switchProject).toHaveBeenCalledWith('/tmp/demo');
    });
    expect(useProjectGroupingStore.getState().projectGroupMap['/tmp/demo']).toBe('ungrouped');
    expect(onClose).toHaveBeenCalled();
  });

  it('克隆模式提交应先调用 clone_repository_cmd 再打开项目', async () => {
    const user = userEvent.setup();
    const switchProject = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState((state) => ({ ...state, switchProject }));

    render(<AddProjectDialog onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: '克隆' }));
    await user.type(screen.getByTestId('add-project-clone-url-input'), 'https://github.com/org/repo.git');
    await user.type(screen.getByTestId('add-project-clone-path-input'), '/tmp/repo');
    await user.click(screen.getByTestId('add-project-submit'));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('clone_repository_cmd', {
        repositoryUrl: 'https://github.com/org/repo.git',
        destinationPath: '/tmp/repo',
      });
    });
    expect(switchProject).toHaveBeenCalledWith('/tmp/repo');
    expect(onClose).toHaveBeenCalled();
  });

  it('对话框点击遮罩层应关闭', async () => {
    const user = userEvent.setup();
    render(<AddProjectDialog onClose={onClose} />);

    await user.click(screen.getByTestId('add-project-dialog-overlay'));

    expect(onClose).toHaveBeenCalled();
  });
});
