/**
 * @file deadlineCountdown.test.ts
 * @description deadlineCountdown 纯函数行为契约
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { describe, it, expect } from 'vitest';
import { daysToDeadline, formatDeadline, deadlineClass } from '../deadlineCountdown';

// 固定基准时间：2026-05-01 00:00:00 UTC
const BASE = new Date('2026-05-01T00:00:00Z');

describe('daysToDeadline', () => {
  it('截止日在未来 7 天返回正数', () => {
    const deadline = '2026-05-08T00:00:00Z'; // 7天后
    expect(daysToDeadline(deadline, BASE)).toBe(7);
  });

  it('截止日已过返回负数', () => {
    const deadline = '2026-04-30T00:00:00Z'; // 昨天
    expect(daysToDeadline(deadline, BASE)).toBe(-1);
  });

  it('当天截止（不足一天）返回 0', () => {
    const deadline = '2026-05-01T23:59:59Z'; // 同天
    expect(daysToDeadline(deadline, BASE)).toBe(0);
  });

  it('超期 3 天返回 -3', () => {
    const deadline = '2026-04-28T00:00:00Z';
    expect(daysToDeadline(deadline, BASE)).toBe(-3);
  });
});

describe('formatDeadline', () => {
  it('正数天数格式化为 Xd', () => {
    expect(formatDeadline(5)).toBe('5d');
    expect(formatDeadline(0)).toBe('0d');
  });

  it('负数天数格式化为 超期 Xd', () => {
    expect(formatDeadline(-3)).toBe('超期 3d');
    expect(formatDeadline(-1)).toBe('超期 1d');
  });
});

describe('deadlineClass', () => {
  it('超期（负数）返回 deadlineHot', () => {
    expect(deadlineClass(-1)).toBe('deadlineHot');
    expect(deadlineClass(-10)).toBe('deadlineHot');
  });

  it('0-6 天内返回 deadlineHot', () => {
    expect(deadlineClass(0)).toBe('deadlineHot');
    expect(deadlineClass(3)).toBe('deadlineHot');
    expect(deadlineClass(6)).toBe('deadlineHot');
  });

  it('7-13 天返回 deadlineWarm', () => {
    expect(deadlineClass(7)).toBe('deadlineWarm');
    expect(deadlineClass(13)).toBe('deadlineWarm');
  });

  it('14 天及以上返回空字符串', () => {
    expect(deadlineClass(14)).toBe('');
    expect(deadlineClass(30)).toBe('');
  });
});
