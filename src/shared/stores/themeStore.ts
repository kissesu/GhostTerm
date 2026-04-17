/**
 * @file themeStore - 应用主题状态管理
 * @description 提供当前已解析（resolved）主题的终端配色和应用配色。
 *              由 settingsStore.appTheme + 系统偏好共同驱动，外部通过 syncTheme() 更新。
 *              终端配色（ITheme）供 xterm.js 使用；AppColors 供需要 JS 计算的内联样式。
 *              大多数 UI 颜色已迁移到 CSS 自定义属性（var(--c-*)），无需 AppColors。
 *              森青 Forge Jade 调色板（色相 175，对齐 App.css 新 token）
 * @author Atlas.oi
 * @date 2026-04-17
 */

import { create } from 'zustand';
import type { ITheme } from '@xterm/xterm';

/** xterm.js 深色终端配色 — 森青 Forge Jade 调色板（cursor 对齐 --c-accent oklch(72% 0.11 175)） */
export const DARK_TERMINAL_THEME: ITheme = {
  background:          '#0d0e1a',
  foreground:          '#d8dcf0',
  cursor:              '#4abba1', // 森青 accent — 值同 DARK_APP_COLORS.accent；源 oklch(72% 0.11 175)
  cursorAccent:        '#0d0e1a',
  selectionBackground: '#4abba138',
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

/** xterm.js 浅色终端配色 — 森青 Forge Jade 调色板（cursor 对齐 --c-accent oklch(48% 0.13 175)） */
export const LIGHT_TERMINAL_THEME: ITheme = {
  background:          '#f7f4ef',
  foreground:          '#1e2038',
  cursor:              '#006e5b', // 森青 accent — 值同 LIGHT_APP_COLORS.accent；源 oklch(48% 0.13 175)
  cursorAccent:        '#f7f4ef',
  selectionBackground: '#006e5b28',
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

// HEX 镜像 App.css 的 --c-* token（OKLCH → sRGB 由 culori 2026-04-17 精确转换）
// 注意：terminalTheme.background/foreground 走独立锚点（见上方 DARK_TERMINAL_THEME），不等同于 APP_COLORS.background/foreground
// 警告：以下 HEX 值镜像 App.css --c-* token，修改 App.css 时必须同步更新此处
export const DARK_APP_COLORS: AppColors = {
  background:          '#030510',  // --c-bg:       oklch(12% 0.028 270)
  backgroundSecondary: '#060a19',  // --c-panel:    oklch(15% 0.032 270)
  border:              '#252d43',  // --c-border:   oklch(30% 0.042 270)
  foreground:          '#dde4f8',  // --c-fg:       oklch(92% 0.028 270)
  foregroundMuted:     '#8b92a5',  // --c-fg-muted: oklch(66% 0.030 270)
  accent:              '#4abba1',  // --c-accent:   oklch(72% 0.11  175) 森青
  danger:              '#ec5258',  // --c-danger:   oklch(65% 0.19  22)
};

// 警告：以下 HEX 值镜像 App.css --c-* token，修改 App.css 时必须同步更新此处
// HEX 由 culori oklch → sRGB 精确转换（2026-04-17）
export const LIGHT_APP_COLORS: AppColors = {
  background:          '#eff2f9',  // --c-bg:       oklch(96% 0.010 270)
  backgroundSecondary: '#e1e4ee',  // --c-panel:    oklch(92% 0.014 270)
  border:              '#b8bdcb',  // --c-border:   oklch(80% 0.020 270)
  foreground:          '#151a29',  // --c-fg:       oklch(22% 0.030 270)
  foregroundMuted:     '#575d6e',  // --c-fg-muted: oklch(48% 0.028 270)
  accent:              '#006e5b',  // --c-accent:   oklch(48% 0.13  175) 森青 light
  danger:              '#b7162d',  // --c-danger:   oklch(50% 0.19  22)
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
