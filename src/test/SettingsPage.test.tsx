import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsPage from '../features/settings/SettingsPage';
import { DEFAULT_TERMINAL_SETTINGS, useSettingsStore } from '../shared/stores/settingsStore';

describe('SettingsPage', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      appView: 'settings',
      terminal: DEFAULT_TERMINAL_SETTINGS,
    });
  });

  it('应渲染终端设置导航和表单', () => {
    render(<SettingsPage />);

    expect(screen.getByTestId('settings-nav-terminal')).toBeInTheDocument();
    expect(screen.getByTestId('terminal-use-system-shell')).toBeInTheDocument();
    expect(screen.getByTestId('terminal-theme')).toBeInTheDocument();
  });

  it('点击返回按钮应切回主界面', async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByTestId('settings-back-button'));

    expect(useSettingsStore.getState().appView).toBe('main');
  });

  it('关闭使用系统默认 shell 后应允许输入自定义 shell 路径', async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

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
