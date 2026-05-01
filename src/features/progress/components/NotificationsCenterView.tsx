/**
 * @file NotificationsCenterView.tsx
 * @description 通知中心视图 - 列表（icon + 内容 + 时间，点击跳详情）
 *              设计稿无 mockup，按 §1.4 简洁布局；未读高亮 + 点击 markRead
 *              字段按实际 API schema（Notification.isRead / body / createdAt）
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { useEffect, type ReactElement } from 'react';
import { useNotificationsStore } from '../stores/notificationsStore';
import { useProgressUiStore } from '../stores/progressUiStore';

export function NotificationsCenterView(): ReactElement {
  const items = useNotificationsStore((s) => s.items);
  const load = useNotificationsStore((s) => s.load);
  const markRead = useNotificationsStore((s) => s.markRead);
  const openProjectFromView = useProgressUiStore((s) => s.openProjectFromView);

  // 进入通知视图时加载列表
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
      {items.length === 0 && (
        <p style={{ padding: 16, color: 'var(--muted)' }}>暂无通知</p>
      )}
      {items.map((n) => (
        <div
          key={n.id}
          data-notification-id={n.id}
          onClick={() => {
            void markRead(n.id);
            if (n.projectId) openProjectFromView(n.projectId, 'notifications');
          }}
          style={{
            padding: 16,
            borderBottom: '1px solid var(--line)',
            cursor: 'pointer',
            // 未读高亮背景（accent 0.04 透明度）
            background: n.isRead ? 'transparent' : 'rgba(184,255,106,0.04)',
            fontSize: 13,
          }}
        >
          <strong>{n.title}</strong>
          <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>{n.body}</div>
          <div style={{ color: 'var(--faint)', fontSize: 11, marginTop: 4 }}>
            {new Date(n.createdAt).toLocaleString('zh-CN')}
          </div>
        </div>
      ))}
    </div>
  );
}
