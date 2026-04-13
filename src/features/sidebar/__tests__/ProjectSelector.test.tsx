/**
 * @file ProjectSelector.test.tsx
 * @description ProjectSelector 组件测试 - 验证项目显示和下拉切换行为
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import ProjectSelector from '../ProjectSelector';
import { useProjectStore } from '../projectStore';
import type { ProjectInfo } from '../../../shared/types';

const mockInvoke = vi.mocked(invoke);

const currentProject: ProjectInfo = {
  name: 'ghostterm',
  path: '/Users/atlas/ghostterm',
  last_opened: 1713024000000,
};

const recentProjects: ProjectInfo[] = [
  currentProject,
  {
    name: 'my-app',
    path: '/Users/atlas/my-app',
    last_opened: 1713020000000,
  },
];

beforeEach(() => {
  useProjectStore.setState({
    currentProject: null,
    recentProjects: [],
  });
  vi.clearAllMocks();
});

describe('ProjectSelector - 无项目状态', () => {
  it('未打开项目时应显示占位文字', () => {
    render(<ProjectSelector />);
    expect(screen.getByText('未打开项目')).toBeInTheDocument();
  });
});

describe('ProjectSelector - 有项目状态', () => {
  beforeEach(() => {
    useProjectStore.setState({ currentProject, recentProjects });
  });

  it('应显示当前项目名称', () => {
    render(<ProjectSelector />);
    expect(screen.getByTestId('current-project-name')).toHaveTextContent('ghostterm');
  });

  it('应显示缩略路径', () => {
    render(<ProjectSelector />);
    const pathEl = screen.getByTestId('current-project-path');
    // 路径包含项目名部分即可
    expect(pathEl.textContent).toContain('ghostterm');
  });
});

describe('ProjectSelector - 下拉列表', () => {
  beforeEach(() => {
    useProjectStore.setState({ currentProject, recentProjects });
  });

  it('初始状态下拉列表应隐藏', () => {
    render(<ProjectSelector />);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('点击按钮应展开下拉列表', () => {
    render(<ProjectSelector />);
    fireEvent.click(screen.getByRole('button', { name: '选择项目' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('下拉列表应渲染所有最近项目', () => {
    render(<ProjectSelector />);
    fireEvent.click(screen.getByRole('button', { name: '选择项目' }));

    // 两个项目都应在下拉中出现
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
  });

  it('应显示打开文件夹按钮', () => {
    render(<ProjectSelector />);
    fireEvent.click(screen.getByRole('button', { name: '选择项目' }));
    expect(screen.getByTestId('open-folder-btn')).toBeInTheDocument();
  });

  it('点击最近项目应调用 switchProject', async () => {
    mockInvoke
      .mockResolvedValueOnce(recentProjects[1])   // open_project_cmd
      .mockResolvedValueOnce(recentProjects);      // list_recent_projects_cmd

    render(<ProjectSelector />);
    fireEvent.click(screen.getByRole('button', { name: '选择项目' }));

    // 点击 my-app 选项
    const options = screen.getAllByRole('option');
    fireEvent.click(options[1]);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('open_project_cmd', {
        path: '/Users/atlas/my-app',
      });
    });
  });

  it('点击项目后下拉列表应关闭', async () => {
    mockInvoke
      .mockResolvedValueOnce(recentProjects[1])
      .mockResolvedValueOnce(recentProjects);

    render(<ProjectSelector />);
    fireEvent.click(screen.getByRole('button', { name: '选择项目' }));
    const options = screen.getAllByRole('option');
    fireEvent.click(options[1]);

    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });
});

describe('ProjectSelector - 空最近列表', () => {
  it('无最近项目时应显示提示文字', () => {
    useProjectStore.setState({ currentProject: null, recentProjects: [] });
    render(<ProjectSelector />);
    fireEvent.click(screen.getByRole('button', { name: '选择项目' }));
    expect(screen.getByText('暂无最近项目')).toBeInTheDocument();
  });
});
