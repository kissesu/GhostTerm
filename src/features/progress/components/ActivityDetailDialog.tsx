/**
 * @file ActivityDetailDialog.tsx
 * @description 时间线条目点击后弹出的详情 modal。
 *
 *              业务流程：
 *              1. DetailTimeline 维护 activeDetail state，点击 ActivityItem 时设置
 *              2. 本组件按 activity.kind 分发渲染对应字段表（key-value 列表）
 *              3. 文件类（thesis_version / project_file_added）渲染下载链接
 *              4. ESC 或点击遮罩关闭
 *
 *              视觉契约（用户反馈 2026-05-03）：
 *              - 复用 progress.module.css 的 .modalOverlay/.modal/.modalHead/.modalBody
 *                与新建项目 / 状态切换弹窗保持完全一致的边框/圆角/阴影/留白
 *              - 详情行用 .detailRow grid（label 88px / value 1fr），逐行下划线
 *              - 时间统一用 formatWhen（按浏览器本地时区渲染 YYYY-MM-DD HH:mm）
 *
 * @author Atlas.oi
 * @date 2026-05-03
 */
import { useEffect, type ReactElement, type ReactNode } from 'react';
import type { Activity } from '../api/activities';
import {
  FEEDBACK_SOURCE_LABEL,
  PAYMENT_DIRECTION_LABEL,
  PROJECT_STATUS_LABEL,
  QUOTE_CHANGE_TYPE_LABEL,
  PROJECT_FILE_CATEGORY_LABEL,
  formatActor,
  formatMoney,
  formatWhen,
  formatDwellMs,
} from './activityRenderers/shared';
import styles from '../progress.module.css';

interface Props {
  activity: Activity;
  onClose: () => void;
}

/** 单行 key-value 渲染 */
function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className={styles.detailRow}>
      <span className={styles.detailLabel}>{label}</span>
      <span className={styles.detailValue}>{children}</span>
    </div>
  );
}

/** 文件下载链接 */
function FileLink({ url, name }: { url: string; name?: string }): ReactElement {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={styles.detailLink}>
      {name ?? '打开文件'}
    </a>
  );
}

/** 审计 metadata 行：IP / 设备；老数据 null 时跳过不渲染避免空行 */
function AuditRows({
  clientIp,
  userAgent,
}: {
  clientIp?: string | null;
  userAgent?: string | null;
}): ReactElement | null {
  if (!clientIp && !userAgent) return null;
  return (
    <>
      {clientIp && <Row label="IP">{clientIp}</Row>}
      {userAgent && <Row label="设备">{userAgent}</Row>}
    </>
  );
}

function renderBody(activity: Activity): ReactElement {
  // 操作人 = displayName（角色） @username；账号 username 让审计追溯精确
  const baseActor = formatActor(activity);
  const actor = activity.actorUsername
    ? `${baseActor} @${activity.actorUsername}`
    : baseActor;
  const when = formatWhen(activity.occurredAt);

  switch (activity.kind) {
    case 'feedback':
      return (
        <div className={styles.detailRows}>
          <Row label="时间">{when}</Row>
          <Row label="操作人">{actor}</Row>
          <Row label="来源">
            {FEEDBACK_SOURCE_LABEL[activity.payload.source] ?? activity.payload.source}
          </Row>
          {activity.payload.attachmentCount > 0 && (
            <Row label="附件数量">{activity.payload.attachmentCount}</Row>
          )}
          <Row label="反馈内容">
            <div style={{ whiteSpace: 'pre-wrap' }}>{activity.payload.content}</div>
          </Row>
        </div>
      );

    case 'payment':
      return (
        <div className={styles.detailRows}>
          <Row label="时间">{when}</Row>
          <Row label="操作人">{actor}</Row>
          <Row label="方向">
            {PAYMENT_DIRECTION_LABEL[activity.payload.direction] ?? activity.payload.direction}
          </Row>
          <Row label="金额">{formatMoney(activity.payload.amount)}</Row>
          {activity.payload.remark && <Row label="备注">{activity.payload.remark}</Row>}
        </div>
      );

    case 'status_change': {
      const dwell = formatDwellMs(activity.payload.dwellMs);
      const fromLabel = activity.payload.fromStatus
        ? (PROJECT_STATUS_LABEL[activity.payload.fromStatus] ?? activity.payload.fromStatus)
        : '初始';
      return (
        <div className={styles.detailRows}>
          <Row label="时间">{when}</Row>
          <Row label="操作人">{actor}</Row>
          <Row label="状态">
            {fromLabel}
            {' → '}
            {PROJECT_STATUS_LABEL[activity.payload.toStatus] ?? activity.payload.toStatus}
          </Row>
          <Row label="事件">{activity.payload.eventName}（{activity.payload.eventCode}）</Row>
          {dwell && activity.payload.fromStatus && (
            <Row label="停留时长">在「{fromLabel}」停留 {dwell}</Row>
          )}
          {activity.payload.remark && <Row label="备注">{activity.payload.remark}</Row>}
        </div>
      );
    }

    case 'quote_change':
      return (
        <div className={styles.detailRows}>
          <Row label="时间">{when}</Row>
          <Row label="操作人">{actor}</Row>
          <Row label="类型">
            {QUOTE_CHANGE_TYPE_LABEL[activity.payload.changeType] ?? activity.payload.changeType}
          </Row>
          <Row label="变更">
            {formatMoney(activity.payload.oldQuote)} → {formatMoney(activity.payload.newQuote)}
          </Row>
          <Row label="差额">{formatMoney(activity.payload.delta)}</Row>
          {activity.payload.reason && <Row label="原因">{activity.payload.reason}</Row>}
        </div>
      );

    case 'thesis_version':
      return (
        <div className={styles.detailRows}>
          <Row label="时间">{when}</Row>
          <Row label="操作人">{actor}</Row>
          <Row label="版本号">v{activity.payload.versionNo}</Row>
          <Row label="文件">
            <FileLink url={`/api/files/${activity.payload.fileId}/download`} name="下载论文版本" />
          </Row>
          {activity.payload.remark && <Row label="备注">{activity.payload.remark}</Row>}
        </div>
      );

    case 'project_file_added':
      return (
        <div className={styles.detailRows}>
          <Row label="时间">{when}</Row>
          <Row label="操作人">{actor}</Row>
          <Row label="类别">
            {PROJECT_FILE_CATEGORY_LABEL[activity.payload.category] ?? activity.payload.category}
          </Row>
          <Row label="文件">
            <FileLink url={`/api/files/${activity.payload.fileId}/download`} name="下载文件" />
          </Row>
        </div>
      );

    case 'project_created':
      return (
        <div className={styles.detailRows}>
          <Row label="时间">{when}</Row>
          <Row label="操作人">{actor}</Row>
          <Row label="项目名">{activity.payload.name}</Row>
          <Row label="初始报价">{formatMoney(activity.payload.originalQuote)}</Row>
          <Row label="优先级">{activity.payload.priority}</Row>
          <Row label="截止时间">{activity.payload.deadline}</Row>
        </div>
      );
  }
}

const KIND_TITLE: Record<Activity['kind'], string> = {
  project_created: '项目创建详情',
  feedback: '反馈详情',
  status_change: '状态变更详情',
  quote_change: '报价变更详情',
  payment: '收款详情',
  thesis_version: '论文版本详情',
  project_file_added: '文件详情',
};

export function ActivityDetailDialog({ activity, onClose }: Props): ReactElement {
  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={KIND_TITLE[activity.kind]}
      onClick={onClose}
      className={`${styles.modalOverlay} ${styles.modalOverlayOpen}`}
      data-testid="activity-detail-dialog"
    >
      <div onClick={(e) => e.stopPropagation()} className={styles.modal}>
        <div className={styles.modalHead}>
          <h3>{KIND_TITLE[activity.kind]}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className={styles.modalClose}
          >
            ×
          </button>
        </div>
        <div className={styles.modalBody}>
          {renderBody(activity)}
          {(activity.clientIp || activity.userAgent) && (
            <div className={styles.detailRows} style={{ marginTop: 12 }}>
              <AuditRows clientIp={activity.clientIp} userAgent={activity.userAgent} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
