import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_TERMINAL_SETTINGS, useSettingsStore } from '../shared/stores/settingsStore';

describe('settingsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      appView: 'main',
      terminal: DEFAULT_TERMINAL_SETTINGS,
    });
  });

  it('应有正确的默认终端设置', () => {
    const state = useSettingsStore.getState();
    expect(state.appView).toBe('main');
    expect(state.terminal).toEqual(DEFAULT_TERMINAL_SETTINGS);
  });

  it('openSettings 和 closeSettings 应切换应用视图', () => {
    useSettingsStore.getState().openSettings();
    expect(useSettingsStore.getState().appView).toBe('settings');

    useSettingsStore.getState().closeSettings();
    expect(useSettingsStore.getState().appView).toBe('main');
  });

  it('updateTerminalSettings 应按补丁更新字段', () => {
    useSettingsStore.getState().updateTerminalSettings({
      useSystemShell: false,
      customShellPath: '/opt/homebrew/bin/fish',
      fontSize: 15,
    });

    expect(useSettingsStore.getState().terminal).toMatchObject({
      useSystemShell: false,
      customShellPath: '/opt/homebrew/bin/fish',
      fontSize: 15,
      cursorStyle: 'block',
    });
  });
});
