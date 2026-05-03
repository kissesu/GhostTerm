/**
 * @file ActorChip.tsx
 * @description 时间线 chip 行右侧的 actor 账号紧凑展示（display_name @username）。
 *
 *              业务需求（用户 2026-05-03）："需要在反馈、状态、创建 tag 右侧显示
 *              提交当前时间线的用户账号的功能, 这样时间线信息才完整。"
 *
 *              排版决策（用户选定 A）：display_name 主，username 用 accent 色后缀，
 *              中间空格分隔，与 GitHub/Slack/Linear 一致。username 缺失（老数据）时
 *              仅渲染 displayName，不留空 @。
 *
 * @author Atlas.oi
 * @date 2026-05-03
 */
import type { ReactElement } from 'react';
import styles from '../../progress.module.css';

interface Props {
  actorName?: string | null;
  actorUsername?: string | null;
}

export function ActorChip({ actorName, actorUsername }: Props): ReactElement {
  const name = actorName ?? '未知';
  return (
    <span className={styles.actor}>
      {name}
      {actorUsername && <span className={styles.username}>@{actorUsername}</span>}
    </span>
  );
}
