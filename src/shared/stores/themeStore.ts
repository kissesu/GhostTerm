/**
 * @file themeStore - 主题状态管理
 * @description 管理应用配色方案，提供给 xterm.js 和 CodeMirror 6 使用。
 *              当前仅实现 dark 主题，配色与 Ghostty 终端保持视觉一致。
 * @author Atlas.oi
 * @date 2026-04-12
 */

import { create } from 'zustand';
import type { ITheme } from '@xterm/xterm';

/** xterm.js 暗色主题配色 - 参考 Ghostty 默认配色 */
export const DARK_TERMINAL_THEME: ITheme = {
  background: '#1a1b26',
  foreground: '#c0caf5',
  cursor: '#c0caf5',
  cursorAccent: '#1a1b26',
  selectionBackground: '#283457',
  // ANSI 标准色
  black: '#15161e',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#a9b1d6',
  // 亮色变体
  brightBlack: '#414868',
  brightRed: '#f7768e',
  brightGreen: '#9ece6a',
  brightYellow: '#e0af68',
  brightBlue: '#7aa2f7',
  brightMagenta: '#bb9af7',
  brightCyan: '#7dcfff',
  brightWhite: '#c0caf5',
};

/** 应用全局配色方案 */
export interface AppColors {
  /** 主背景色 */
  background: string;
  /** 次要背景色（侧边栏、面板头部） */
  backgroundSecondary: string;
  /** 边框颜色 */
  border: string;
  /** 主文字颜色 */
  foreground: string;
  /** 次要文字颜色 */
  foregroundMuted: string;
  /** 强调色（活动标签、选中项） */
  accent: string;
  /** 危险操作颜色（删除等） */
  danger: string;
}

export const DARK_APP_COLORS: AppColors = {
  background: '#1a1b26',
  backgroundSecondary: '#16161e',
  border: '#27293d',
  foreground: '#c0caf5',
  foregroundMuted: '#565f89',
  accent: '#7aa2f7',
  danger: '#f7768e',
};

interface ThemeState {
  /** 当前主题模式（MVP 仅支持 dark） */
  mode: 'dark';
  /** xterm.js 使用的终端配色 */
  terminalTheme: ITheme;
  /** 应用 UI 配色 */
  appColors: AppColors;
}

/** themeStore - 全局主题状态，其他 store 通过此获取配色常量 */
export const useThemeStore = create<ThemeState>(() => ({
  mode: 'dark',
  terminalTheme: DARK_TERMINAL_THEME,
  appColors: DARK_APP_COLORS,
}));
