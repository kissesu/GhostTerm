/**
 * @file themeStore - 应用主题状态管理
 * @description 提供当前已解析（resolved）主题的终端配色和应用配色。
 *              由 settingsStore.appTheme + 系统偏好共同驱动，外部通过 syncTheme() 更新。
 *              终端配色（ITheme）供 xterm.js 使用；AppColors 供需要 JS 计算的内联样式。
 *              大多数 UI 颜色已迁移到 CSS 自定义属性（var(--c-*)），无需 AppColors。
 * @author Atlas.oi
 * @date 2026-04-15
 */

import { create } from 'zustand';
import type { ITheme } from '@xterm/xterm';

/** xterm.js 深色终端配色 — Obsidian Brass 调色板 */
export const DARK_TERMINAL_THEME: ITheme = {
  background:          '#0d0e1a',
  foreground:          '#d8dcf0',
  cursor:              '#d4a93e',
  cursorAccent:        '#0d0e1a',
  selectionBackground: '#d4a93e33',
  black:               '#0a0b16',
  red:                 '#d95f6f',
  green:               '#5ab87c',
  yellow:              '#d4a93e',
  blue:                '#6b9cf5',
  magenta:             '#b289e8',
  cyan:                '#5bbfd4',
  white:               '#a8b0d0',
  brightBlack:         '#3d4468',
  brightRed:           '#f07088',
  brightGreen:         '#72cc94',
  brightYellow:        '#e8c060',
  brightBlue:          '#85adff',
  brightMagenta:       '#c9a4f5',
  brightCyan:          '#78d4e8',
  brightWhite:         '#d8dcf0',
};

/** xterm.js 浅色终端配色 — 暖白调色板 */
export const LIGHT_TERMINAL_THEME: ITheme = {
  background:          '#f7f4ef',
  foreground:          '#1e2038',
  cursor:              '#9b6e00',
  cursorAccent:        '#f7f4ef',
  selectionBackground: '#9b6e0022',
  black:               '#1e2038',
  red:                 '#b3434f',
  green:               '#338a54',
  yellow:              '#9b6e00',
  blue:                '#2d6fcc',
  magenta:             '#7a40b8',
  cyan:                '#1e7b8a',
  white:               '#8090b0',
  brightBlack:         '#5a6280',
  brightRed:           '#d05562',
  brightGreen:         '#46a86a',
  brightYellow:        '#bf8a00',
  brightBlue:          '#4285e8',
  brightMagenta:       '#9254cc',
  brightCyan:          '#2698a8',
  brightWhite:         '#3a4060',
};

/** 应用 UI 配色（供需要 JS 计算的少数场景使用，大多数颜色已迁移至 CSS 变量） */
export interface AppColors {
  background: string;
  backgroundSecondary: string;
  border: string;
  foreground: string;
  foregroundMuted: string;
  accent: string;
  danger: string;
}

export const DARK_APP_COLORS: AppColors = {
  background:          '#0d0e1a',
  backgroundSecondary: '#11131f',
  border:              '#1e2240',
  foreground:          '#d8dcf0',
  foregroundMuted:     '#586088',
  accent:              '#d4a93e',
  danger:              '#d95f6f',
};

export const LIGHT_APP_COLORS: AppColors = {
  background:          '#f7f4ef',
  backgroundSecondary: '#ede9e3',
  border:              '#d4cfc7',
  foreground:          '#1e2038',
  foregroundMuted:     '#5a6280',
  accent:              '#9b6e00',
  danger:              '#b3434f',
};

export type ResolvedTheme = 'dark' | 'light';

interface ThemeState {
  /** 当前已解析的主题模式（已处理 system → dark/light） */
  mode: ResolvedTheme;
  /** 供 xterm.js 使用的终端配色 */
  terminalTheme: ITheme;
  /** 供需要 JS 计算的内联样式使用的配色（大多数颜色请用 CSS 变量） */
  appColors: AppColors;
}

export const useThemeStore = create<ThemeState>(() => ({
  mode:          'dark',
  terminalTheme: DARK_TERMINAL_THEME,
  appColors:     DARK_APP_COLORS,
}));

/**
 * syncTheme — 根据 appTheme 设置和系统偏好更新 themeStore
 * 在 App.tsx useEffect 中调用，确保主题与设置同步
 */
export function syncTheme(
  appTheme: 'dark' | 'light' | 'system',
  systemDark: boolean,
): ResolvedTheme {
  const resolved: ResolvedTheme =
    appTheme === 'system' ? (systemDark ? 'dark' : 'light') : appTheme;

  useThemeStore.setState({
    mode:          resolved,
    terminalTheme: resolved === 'dark' ? DARK_TERMINAL_THEME : LIGHT_TERMINAL_THEME,
    appColors:     resolved === 'dark' ? DARK_APP_COLORS   : LIGHT_APP_COLORS,
  });

  return resolved;
}

/** 根据终端主题 ID 获取 xterm.js 主题（向后兼容工具函数） */
export function getTerminalThemeById(themeId: 'ghostterm-dark' | 'ghostterm-light'): ITheme {
  return themeId === 'ghostterm-light' ? LIGHT_TERMINAL_THEME : DARK_TERMINAL_THEME;
}
