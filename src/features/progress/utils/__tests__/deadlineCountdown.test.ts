/**
 * @file deadlineCountdown.test.ts
 * @description Phase 10 deadline 倒计时纯函数单测：
 *              - daysUntil 边界（同日 / 明天 / 昨天 / 跨月）
 *              - severityFromDays 阈值（critical ≤ 2 / warning ≤ 7 / ok > 7 / 超期）
 *              - severityColor 与 CSS 变量映射
 *              - deadlineLabel 文案（已超期 / 今日到期 / N天）
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { describe, expect, it } from 'vitest';

import {
  daysUntil,
  severityFromDays,
  severityColor,
  deadlineLabel,
} from '../deadlineCountdown';

// ============================================
// daysUntil
// ============================================
describe('daysUntil', () => {
  it('同一日历日返回 0', () => {
    const now = new Date(2026, 3, 29, 10, 0, 0);
    const deadline = new Date(2026, 3, 29, 18, 0, 0);
    expect(daysUntil(deadline, now)).toBe(0);
  });

  it('明天到期返回 1', () => {
    const now = new Date(2026, 3, 29, 23, 0, 0);
    const deadline = new Date(2026, 3, 30, 0, 1, 0);
    expect(daysUntil(deadline, now)).toBe(1);
  });

  it('昨天就过期返回 -1', () => {
    const now = new Date(2026, 3, 29, 0, 1, 0);
    const deadline = new Date(2026, 3, 28, 23, 59, 0);
    expect(daysUntil(deadline, now)).toBe(-1);
  });

  it('跨月计算正确（4/29 → 5/2 = 3 天）', () => {
    const now = new Date(2026, 3, 29);
    const deadline = new Date(2026, 4, 2);
    expect(daysUntil(deadline, now)).toBe(3);
  });

  it('远期（一个月）返回正值', () => {
    const now = new Date(2026, 3, 1);
    const deadline = new Date(2026, 4, 1);
    expect(daysUntil(deadline, now)).toBeGreaterThan(20);
  });
});

// ============================================
// severityFromDays
// ============================================
describe('severityFromDays', () => {
  it('已超期（负数）→ critical', () => {
    expect(severityFromDays(-1)).toBe('critical');
    expect(severityFromDays(-30)).toBe('critical');
  });

  it('0 / 1 / 2 天 → critical', () => {
    expect(severityFromDays(0)).toBe('critical');
    expect(severityFromDays(1)).toBe('critical');
    expect(severityFromDays(2)).toBe('critical');
  });

  it('3 - 7 天 → warning', () => {
    expect(severityFromDays(3)).toBe('warning');
    expect(severityFromDays(5)).toBe('warning');
    expect(severityFromDays(7)).toBe('warning');
  });

  it('> 7 天 → ok', () => {
    expect(severityFromDays(8)).toBe('ok');
    expect(severityFromDays(30)).toBe('ok');
  });
});

// ============================================
// severityColor
// ============================================
describe('severityColor', () => {
  it('ok → --c-green', () => {
    expect(severityColor('ok')).toBe('var(--c-green)');
  });
  it('warning → --c-yellow', () => {
    expect(severityColor('warning')).toBe('var(--c-yellow)');
  });
  it('critical → --c-red', () => {
    expect(severityColor('critical')).toBe('var(--c-red)');
  });
});

// ============================================
// deadlineLabel
// ============================================
describe('deadlineLabel', () => {
  it('负数 → 已超期 N d', () => {
    expect(deadlineLabel(-1)).toBe('已超期 1d');
    expect(deadlineLabel(-7)).toBe('已超期 7d');
  });

  it('0 → 今日到期', () => {
    expect(deadlineLabel(0)).toBe('今日到期');
  });

  it('正数 → "Nd" 简短文案', () => {
    expect(deadlineLabel(3)).toBe('3d');
    expect(deadlineLabel(15)).toBe('15d');
  });
});
