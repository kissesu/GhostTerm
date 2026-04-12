/**
 * @file themeStore.test.ts - themeStore 单元测试
 * @description 验证 dark 配色常量正确（PBI-0 任务 0.9 TDD 测试）
 * @author Atlas.oi
 * @date 2026-04-12
 */

import { describe, it, expect } from 'vitest';
import { useThemeStore, DARK_TERMINAL_THEME, DARK_APP_COLORS } from '../shared/stores/themeStore';

describe('themeStore', () => {
  it('默认主题模式为 dark', () => {
    const { mode } = useThemeStore.getState();
    expect(mode).toBe('dark');
  });

  it('终端背景色为深色（不是白色）', () => {
    expect(DARK_TERMINAL_THEME.background).toBeDefined();
    // 验证不是亮色主题
    expect(DARK_TERMINAL_THEME.background).not.toBe('#ffffff');
    expect(DARK_TERMINAL_THEME.background).not.toBe('#fff');
  });

  it('终端主题包含所有必要的 ANSI 颜色', () => {
    const required = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
    for (const color of required) {
      expect(DARK_TERMINAL_THEME).toHaveProperty(color);
    }
  });

  it('应用配色包含所有必要的 UI 颜色', () => {
    const required = ['background', 'backgroundSecondary', 'border', 'foreground', 'accent'];
    for (const color of required) {
      expect(DARK_APP_COLORS).toHaveProperty(color);
    }
  });
});
