/**
 * @file deadlineCountdown.ts
 * @description Deadline 倒计时纯函数集（Phase 10）。
 *
 *              业务背景（spec §10.4 风险分级）：
 *              - 距 deadline ≤ 2 天 = critical（红色，强警示）
 *              - 距 deadline ≤ 7 天 = warning（橙色，注意）
 *              - 距 deadline >  7 天 = ok（绿色，安全）
 *              - 已超期（days < 0）按 critical 处理；UI 文案另行渲染"已超期 N 天"
 *
 *              不在本文件做的事：
 *              - 不渲染 UI（保持纯函数，便于测试 + 复用）
 *              - 不做时区换算（接收方传入 Date；调用方负责 ISO → Date 转换）
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

/**
 * Deadline 严重度档位。
 *
 * 与 spec §10.4 风险总览四分级对齐（safe/notice/urgent/overdue）：
 *   - 'ok'       绿  >7 天
 *   - 'warning'  黄/橙  3-7 天（v1 简化为单档 warning）
 *   - 'critical' 红  ≤2 天 / 已超期
 */
export type DeadlineSeverity = 'ok' | 'warning' | 'critical';

/**
 * 计算距 deadline 还剩多少天（基于"日"粒度，向下取整）。
 *
 * 业务规则：
 *  - 同一天 → 0
 *  - 明天到期 → 1
 *  - 昨天就过期 → -1（负数 = 已超期天数）
 *
 * 实现细节：
 *  - 计算时只比较"日历日"，把双方都拍到当地零点再相减；
 *    避免"今天 15:00 录入，明天 09:00 到期"被算作 0.75 天 → 0
 *
 * @param deadline ISO 字符串解析后的 Date 对象
 * @param now      当前时间，缺省 = 调用时 new Date()；测试可注入固定时间
 */
export function daysUntil(deadline: Date, now: Date = new Date()): number {
  const oneDay = 24 * 60 * 60 * 1000;
  // 业务约定：按本地时区"日"粒度比较；同一天 deadline 算剩 0 天
  const a = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a.getTime() - b.getTime()) / oneDay);
}

/**
 * 根据剩余天数返回严重度档位。
 *
 * 阈值：
 *  - days < 0    → 'critical'（已超期）
 *  - days ≤ 2    → 'critical'
 *  - days ≤ 7    → 'warning'
 *  - days > 7    → 'ok'
 */
export function severityFromDays(days: number): DeadlineSeverity {
  if (days < 0) return 'critical';
  if (days <= 2) return 'critical';
  if (days <= 7) return 'warning';
  return 'ok';
}

/**
 * 把严重度映射为 CSS 颜色变量（项目 OKLCH Forge Jade 主题）。
 *
 * 业务背景：
 *  - 列表/看板的 deadline 徽章用此颜色填充背景或边框
 *  - 走 CSS 变量保持 dark/light 主题一致；不引入新 token
 *
 * 取值规则（spec §10.6）：
 *  - ok       → --c-green
 *  - warning  → --c-yellow（spec 也允许 --c-orange，v1 选 yellow 让"warning"和"critical"颜色对比更显著）
 *  - critical → --c-red
 */
export function severityColor(severity: DeadlineSeverity): string {
  switch (severity) {
    case 'ok':
      return 'var(--c-green)';
    case 'warning':
      return 'var(--c-yellow)';
    case 'critical':
      return 'var(--c-red)';
  }
}

/**
 * 把"剩余天数 + 严重度"翻译成中文短文案。
 *
 * 用于徽章主体文字，列表/看板/详情共用，避免每个组件都重写。
 */
export function deadlineLabel(days: number): string {
  if (days < 0) return `已超期 ${-days}d`;
  if (days === 0) return '今日到期';
  return `${days}d`;
}
