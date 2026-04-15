/**
 * @file settingsStore - 应用设置状态管理
 * @description 管理应用视图切换与终端设置。终端设置持久化到本地存储，
 *              应用视图不持久化，避免重启后停留在设置页。
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type AppView = 'main' | 'settings';
export type TerminalCursorStyle = 'block' | 'underline' | 'bar';
export type TerminalThemeId = 'ghostterm-dark' | 'ghostterm-light';

export interface TerminalSettings {
  useSystemShell: boolean;
  customShellPath: string;
  fontSize: number;
  fontFamily: string;
  cursorStyle: TerminalCursorStyle;
  theme: TerminalThemeId;
}

interface PersistedSettingsState {
  terminal: TerminalSettings;
}

interface SettingsState extends PersistedSettingsState {
  appView: AppView;
  setAppView: (view: AppView) => void;
  openSettings: () => void;
  closeSettings: () => void;
  updateTerminalSettings: (patch: Partial<TerminalSettings>) => void;
}

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  useSystemShell: true,
  customShellPath: '',
  fontSize: 13,
  fontFamily: "Menlo, Monaco, 'Courier New', monospace",
  cursorStyle: 'block',
  theme: 'ghostterm-dark',
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      appView: 'main',
      terminal: DEFAULT_TERMINAL_SETTINGS,

      setAppView: (view) => set({ appView: view }),
      openSettings: () => set({ appView: 'settings' }),
      closeSettings: () => set({ appView: 'main' }),
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
        terminal: state.terminal,
      }),
    },
  ),
);
