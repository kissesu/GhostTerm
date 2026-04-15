/**
 * @file settingsStore - 应用设置状态管理
 * @description 管理应用视图切换与全局设置。
 *              appTheme 控制整个应用的外观（dark/light/system），不再局限于终端。
 *              终端设置管理 shell、字体等，主题已上移至应用级别。
 * @author Atlas.oi
 * @date 2026-04-15
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type AppView = 'main' | 'settings';
export type TerminalCursorStyle = 'block' | 'underline' | 'bar';

/** 应用级主题：dark / light / system（跟随系统） */
export type AppTheme = 'dark' | 'light' | 'system';

export interface TerminalSettings {
  useSystemShell: boolean;
  customShellPath: string;
  fontSize: number;
  fontFamily: string;
  cursorStyle: TerminalCursorStyle;
}

interface PersistedSettingsState {
  appTheme: AppTheme;
  terminal: TerminalSettings;
}

interface SettingsState extends PersistedSettingsState {
  appView: AppView;
  setAppView: (view: AppView) => void;
  openSettings: () => void;
  closeSettings: () => void;
  updateAppTheme: (theme: AppTheme) => void;
  updateTerminalSettings: (patch: Partial<TerminalSettings>) => void;
}

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  useSystemShell: true,
  customShellPath: '',
  fontSize: 13,
  fontFamily: "JetBrains Mono, Fira Code, Cascadia Code, SF Mono, Menlo, monospace",
  cursorStyle: 'block',
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      appView: 'main',
      appTheme: 'dark',
      terminal: DEFAULT_TERMINAL_SETTINGS,

      setAppView: (view) => set({ appView: view }),
      openSettings: () => set({ appView: 'settings' }),
      closeSettings: () => set({ appView: 'main' }),
      updateAppTheme: (appTheme) => set({ appTheme }),
      updateTerminalSettings: (patch) =>
        set((state) => ({
          terminal: {
            ...state.terminal,
            ...patch,
          },
        })),
    }),
    {
      name: 'ghostterm-settings',
      storage: createJSONStorage(() => localStorage),
      partialize: (state): PersistedSettingsState => ({
        appTheme: state.appTheme,
        terminal: state.terminal,
      }),
    },
  ),
);
