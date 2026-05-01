/**
 * @file deadlineCountdown.ts
 * @description 截止日期倒计时纯函数工具：天数计算 / 格式化 / 颜色分级
 *              设计稿 line 715-716 规定：< 7d → hot（红），< 14d → warm（橙），其余默认
 * @author Atlas.oi
 * @date 2026-05-01
 */

/**
 * 计算距截止日期的剩余天数。
 *
 * @param deadlineISO 截止日期 ISO 字符串（如 "2026-06-01T23:59:59Z"）
 * @param now 当前时间，默认 new Date()，单测可传入固定时间
 * @returns 正数 = 剩余天数，负数 = 已超期（按完整天数向下取整）
 */
export function daysToDeadline(deadlineISO: string, now: Date = new Date()): number {
  const deadlineMs = new Date(deadlineISO).getTime();
  const nowMs = now.getTime();
  // 按完整天数向下取整，负数方向同样向下（如 -0.5d → -1d = 已超期1天）
  return Math.floor((deadlineMs - nowMs) / (1000 * 60 * 60 * 24));
}

/**
 * 格式化剩余天数为可读字符串。
 *
 * @param days daysToDeadline 返回值
 * @returns "超期 Xd"（超期时）/ "Xd"（正常时）
 */
export function formatDeadline(days: number): string {
  if (days < 0) {
    return `超期 ${Math.abs(days)}d`;
  }
  return `${days}d`;
}

/**
 * 根据剩余天数返回设计稿规定的 CSS module class key。
 *
 * 规则（设计稿 line 715-716）：
 *   - days < 0 或 days < 7  → 'deadlineHot'（危急红色）
 *   - days < 14             → 'deadlineWarm'（警告橙色）
 *   - 其余                   → ''（默认色）
 *
 * @param days daysToDeadline 返回值
 * @returns CSS module class key
 */
export function deadlineClass(days: number): 'deadlineHot' | 'deadlineWarm' | '' {
  if (days < 0 || days < 7) return 'deadlineHot';
  if (days < 14) return 'deadlineWarm';
  return '';
}
