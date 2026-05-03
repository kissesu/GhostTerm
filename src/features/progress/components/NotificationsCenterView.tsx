/**
 * @file NotificationsCenterView.tsx
 * @description 通知中心视图（用户反馈 2026-05-03 重构）：
 *
 *              视觉契约（按截图 03）：
 *              - 左侧 8px 圆点：未读 = accent 高亮 + 光晕；已读 = faint 灰
 *              - 中间：title 加粗 + body 灰色描述
 *              - 右侧时间徽章：
 *                  · 未读 < 5 分钟  → "刚刚"  红色 chip
 *                  · 未读 < 24 小时 → "Nm/Nh" 黄色 chip
 *                  · 未读 ≥ 24 小时 → "Nd/MM-DD" 黄色 chip
 *                  · 已读           → "已读" 灰色 chip
 *
 *              交互：点击 → markRead + 若有 projectId 跳详情
 *
 * @author Atlas.oi
 * @date 2026-05-03
 */
import { useEffect, type ReactElement } from 'react';
import styles from '../progress.module.css';
import { useNotificationsStore } from '../stores/notificationsStore';
import { useProgressUiStore } from '../stores/progressUiStore';

/** 时间徽章计算：返回文案 + 类型（决定颜色） */
function describeBadge(
  iso: string,
  isRead: boolean,
): { text: string; tone: 'fresh' | 'recent' | 'read' } {
  if (isRead) return { text: '已读', tone: 'read' };
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diffMs = Math.max(0, now - t);
  const min = Math.floor(diffMs / 60_000);
  if (min < 5) return { text: '刚刚', tone: 'fresh' };
  if (min < 60) return { text: `${min}m`, tone: 'recent' };
  const hour = Math.floor(min / 60);
  if (hour < 24) return { text: `${hour}h`, tone: 'recent' };
  const day = Math.floor(hour / 24);
  if (day < 7) return { text: `${day}d`, tone: 'recent' };
  // 超过一周回退绝对日期 MM-DD
  const d = new Date(iso);
  const mo = (d.getMonth() + 1).toString().padStart(2, '0');
  const dd = d.getDate().toString().padStart(2, '0');
  return { text: `${mo}-${dd}`, tone: 'recent' };
}

export function NotificationsCenterView(): ReactElement {
  const items = useNotificationsStore((s) => s.items);
  const load = useNotificationsStore((s) => s.load);
  const markRead = useNotificationsStore((s) => s.markRead);
  const openProjectFromView = useProgressUiStore((s) => s.openProjectFromView);

  // 进入通知视图时加载列表
  useEffect(() => {
    void load();
  }, [load]);

  if (items.length === 0) {
    return <div className={styles.notifEmpty}>暂无通知</div>;
  }

  return (
    <div className={styles.notifList}>
      {items.map((n) => {
        const badge = describeBadge(n.createdAt, n.isRead);
        const badgeClass =
          badge.tone === 'fresh'
            ? styles.notifBadgeFresh
            : badge.tone === 'recent'
              ? styles.notifBadgeRecent
              : styles.notifBadgeRead;
        return (
          <div
            key={n.id}
            data-notification-id={n.id}
            onClick={() => {
              void markRead(n.id);
              if (n.projectId) openProjectFromView(n.projectId, 'notifications');
            }}
            className={styles.notifItem}
          >
            <span className={`${styles.notifDot} ${n.isRead ? styles.notifDotRead : ''}`} />
            <div className={styles.notifMain}>
              <div className={styles.notifTitle}>{n.title}</div>
              <div className={styles.notifBody}>{n.body}</div>
            </div>
            <span className={`${styles.notifBadge} ${badgeClass}`}>{badge.text}</span>
          </div>
        );
      })}
    </div>
  );
}
