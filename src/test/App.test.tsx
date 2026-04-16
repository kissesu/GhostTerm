import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';
import { DEFAULT_TERMINAL_SETTINGS, useSettingsStore } from '../shared/stores/settingsStore';

vi.mock('../layouts/AppLayout', () => ({
  default: () => <div data-testid="app-layout">主界面</div>,
}));

vi.mock('../features/settings', () => ({
  SettingsPage: () => <div data-testid="settings-page">设置页</div>,
}));

// SearchModal 使用 searchStore，searchStore 内有 invoke 调用，mock 避免测试环境报错
vi.mock('../features/search/SearchModal', () => ({
  default: () => null,
}));

// useOpenWithFile 在 mount 时调用 Tauri invoke/listen，mock 为 no-op 避免测试环境报错
vi.mock('../shared/hooks/useOpenWithFile', () => ({
  useOpenWithFile: () => undefined,
}));

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      appView: 'main',
      terminal: DEFAULT_TERMINAL_SETTINGS,
    });
  });

  it('默认应渲染主界面', () => {
    render(<App />);
    expect(screen.getByTestId('app-layout')).toBeInTheDocument();
  });

  it('appView 为 settings 时应渲染设置页', () => {
    useSettingsStore.setState({ appView: 'settings' });
    render(<App />);

    expect(screen.getByTestId('settings-page')).toBeInTheDocument();
  });
});
