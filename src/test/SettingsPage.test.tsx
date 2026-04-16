import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsPage from '../features/settings/SettingsPage';
import { DEFAULT_TERMINAL_SETTINGS, useSettingsStore } from '../shared/stores/settingsStore';
import type { UpdaterState, UpdaterActions } from '../features/updater/useUpdater';

// 测试用的 updater stub
const stubState: UpdaterState = {
  available: false, version: null, notes: null,
  installing: false, progress: null, error: null,
};
const stubActions: UpdaterActions = {
  applyUpdate: async () => {},
  dismiss: () => {},
  checkNow: async () => {},
};

describe('SettingsPage', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      appView: 'settings',
      terminal: DEFAULT_TERMINAL_SETTINGS,
    });
  });

  it('应渲染外观和终端导航项，默认显示外观分区', () => {
    render(<SettingsPage updateState={stubState} updateActions={stubActions} />);

    // 导航项始终可见
    expect(screen.getByTestId('settings-nav-appearance')).toBeInTheDocument();
    expect(screen.getByTestId('settings-nav-terminal')).toBeInTheDocument();
    // 默认分区是外观：主题选择卡片可见
    expect(screen.getByTestId('app-theme-selector')).toBeInTheDocument();
  });

  it('点击终端导航后应渲染终端表单', async () => {
    const user = userEvent.setup();
    render(<SettingsPage updateState={stubState} updateActions={stubActions} />);

    // 导航到终端分区
    await user.click(screen.getByTestId('settings-nav-terminal'));

    expect(screen.getByTestId('terminal-use-system-shell')).toBeInTheDocument();
    expect(screen.getByTestId('terminal-custom-shell')).toBeInTheDocument();
    expect(screen.getByTestId('terminal-font-size')).toBeInTheDocument();
  });

  it('点击返回按钮应切回主界面', async () => {
    const user = userEvent.setup();
    render(<SettingsPage updateState={stubState} updateActions={stubActions} />);

    await user.click(screen.getByTestId('settings-back-button'));

    expect(useSettingsStore.getState().appView).toBe('main');
  });

  it('关闭使用系统默认 shell 后应允许输入自定义 shell 路径', async () => {
    const user = userEvent.setup();
    render(<SettingsPage updateState={stubState} updateActions={stubActions} />);

    // 终端表单在 terminal 分区，需先导航
    await user.click(screen.getByTestId('settings-nav-terminal'));

    const useSystemShell = screen.getByTestId('terminal-use-system-shell');
    const customShell = screen.getByTestId('terminal-custom-shell') as HTMLInputElement;

    expect(customShell.disabled).toBe(true);

    await user.click(useSystemShell);
    expect(customShell.disabled).toBe(false);

    await user.clear(customShell);
    await user.type(customShell, '/opt/homebrew/bin/fish');

    expect(useSettingsStore.getState().terminal).toMatchObject({
      useSystemShell: false,
      customShellPath: '/opt/homebrew/bin/fish',
    });
  });
});
