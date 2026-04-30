/**
 * @file ProgressSummary.tsx
 * @description 进度模块顶部 6 张统计卡片（设计稿 §summary）。
 *
 *              业务背景（设计稿 1:1 复刻）：
 *              - 6 张卡片：总项目 / 活跃推进 / 今日到期 / 客户反馈 / 已交付 / 已收款
 *              - 数据来自 projectsStore + earningsStore + notificationsStore
 *              - 数字过低的 1 位字段补 0（设计稿示例 "04" / "07"）
 *
 *              数据派生口径：
 *              - 总项目        = projects.size
 *              - 活跃推进      = status ∈ {dealing, quoting, developing, confirming, after_sales}
 *              - 今日到期      = daysUntil(deadline) === 0
 *              - 客户反馈      = TODO 未来对接 feedbacksStore unread；当前显示 notifications 未读数
 *              - 已交付        = status === 'delivered'
 *              - 已收款        = earningsStore.summary.totalEarned (未加载 → '—')
 *
 *              数字格式化：
 *              - 普通项目数：< 10 → "0N"，>= 10 → "N"（贴合设计稿 "26" / "04" 风格）
 *              - 金额：转为 ¥X.Yk 简短格式（例：¥38.5k）
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { useEffect, useMemo, type ReactElement } from 'react';

import { useProjectsStore } from '../stores/projectsStore';
import { useEarningsStore } from '../stores/earningsStore';
import { useNotificationsStore } from '../stores/notificationsStore';
import { daysUntil } from '../utils/deadlineCountdown';
import styles from '../progress.module.css';

/**
 * 把整数格式化为定长 2 位字符串（设计稿风格）：
 *  - 0-9 → "00"-"09"
 *  - 10+ → 原值
 */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * 把金额（Money 字符串，如 "38500.00"）格式化为 "¥38.5k" 简短形式。
 * 业务规则：
 *  - >= 10000 → "¥X.Yk"（保留 1 位小数）
 *  - 1000-9999 → "¥X.Yk"
 *  - < 1000 → "¥XXX"
 *  - 解析失败 → "—"
 */
function formatMoneyShort(money: string | undefined | null): string {
  if (!money) return '¥0';
  const n = Number.parseFloat(money);
  if (!Number.isFinite(n)) return '—';
  if (n >= 1000) {
    return `¥${(n / 1000).toFixed(1)}k`;
  }
  return `¥${n.toFixed(0)}`;
}

/** 活跃推进态白名单 */
const ACTIVE_STATUSES = new Set(['dealing', 'quoting', 'developing', 'confirming', 'after_sales']);

export function ProgressSummary(): ReactElement {
  // 业务流程：
  // 1. 订阅 projectsStore.projects（Map）做派生统计
  // 2. 订阅 earnings.summary 取 totalEarned
  // 3. 订阅 notifications 取未读数（暂代客户反馈，TODO: 后续对接 feedbacksStore）
  const projectsMap = useProjectsStore((s) => s.projects);
  const earningsSummary = useEarningsStore((s) => s.summary);
  const refetchEarnings = useEarningsStore((s) => s.refetch);
  const notifications = useNotificationsStore((s) => s.notifications);

  // 首次挂载：拉一次 earnings；失败静默（Summary 仅展示，不阻塞主流程）
  useEffect(() => {
    void refetchEarnings().catch(() => {
      // earnings 未加载时显示 '—'，不打扰用户
    });
  }, [refetchEarnings]);

  // 派生统计（Map.size 变化才重算）
  const stats = useMemo(() => {
    const all = Array.from(projectsMap.values());
    const active = all.filter((p) => ACTIVE_STATUSES.has(p.status)).length;
    const today = all.filter((p) => {
      try {
        return daysUntil(new Date(p.deadline)) === 0;
      } catch {
        return false;
      }
    }).length;
    const delivered = all.filter((p) => p.status === 'delivered').length;
    return {
      total: all.length,
      active,
      today,
      delivered,
    };
  }, [projectsMap]);

  // TODO: 接入 feedbacksStore 后改为 "未读反馈数"；目前用 notifications 未读数代替
  const unreadFeedback = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications],
  );

  const moneyText = formatMoneyShort(earningsSummary?.totalEarned);

  return (
    <section className={styles.summary} data-testid="progress-summary">
      <div className={styles.summaryCard} data-testid="summary-total">
        <span>总项目</span>
        <strong>{pad2(stats.total)}</strong>
      </div>
      <div className={styles.summaryCard} data-testid="summary-active">
        <span>活跃推进</span>
        <strong>{pad2(stats.active)}</strong>
      </div>
      <div className={styles.summaryCard} data-testid="summary-today">
        <span>今日到期</span>
        <strong>{pad2(stats.today)}</strong>
      </div>
      <div className={styles.summaryCard} data-testid="summary-feedback">
        <span>客户反馈</span>
        <strong>{pad2(unreadFeedback)}</strong>
      </div>
      <div className={styles.summaryCard} data-testid="summary-delivered">
        <span>已交付</span>
        <strong>{pad2(stats.delivered)}</strong>
      </div>
      <div className={styles.summaryCard} data-testid="summary-paid">
        <span>已收款</span>
        <strong>{moneyText}</strong>
      </div>
    </section>
  );
}
