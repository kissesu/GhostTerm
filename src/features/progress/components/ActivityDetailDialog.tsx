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
import { FileItem } from './FileItem';
import { useNow } from '../hooks/useNow';
import {
  PAYMENT_DIRECTION_LABEL,
  PROJECT_STATUS_LABEL,
  PROJECT_PRIORITY_LABEL,
  QUOTE_CHANGE_TYPE_LABEL,
  PROJECT_FILE_CATEGORY_LABEL,
  EVENT_FIELD_LABEL,
  formatActor,
  formatMoney,
  formatWhen,
  formatDwellMs,
  parseRemarkFields,
  normalizeClientIp,
  parseUserAgentPlatform,
} from './activityRenderers/shared';
import styles from '../progress.module.css';

interface Props {
  activity: Activity;
  onClose: () => void;
  /** 仅 status_change 关心：是否当前最新阶段（实时显示"已停留 X"，否则只显示 historical） */
  isCurrentStatus?: boolean;
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

/** 审计 metadata 行：IP / 设备；老数据 null 时跳过不渲染避免空行 */
function AuditRows({
  clientIp,
  userAgent,
}: {
  clientIp?: string | null;
  userAgent?: string | null;
}): ReactElement | null {
  if (!clientIp && !userAgent) return null;
  // normalizeClientIp 兜底历史数据 ::1 → 127.0.0.1（后端 middleware 已同款归一化覆盖新数据）
  const ip = normalizeClientIp(clientIp);
  // 设备只显示平台名（用户反馈 2026-05-03）；完整 UA 字符串过长不利审计阅读
  const platform = parseUserAgentPlatform(userAgent);
  return (
    <>
      {ip && <Row label="IP">{ip}</Row>}
      {platform && <Row label="设备">{platform}</Row>}
    </>
  );
}

function renderBody(activity: Activity, isCurrentStatus?: boolean, now?: number): ReactElement {
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
          <Row label="反馈内容">
            <div style={{ whiteSpace: 'pre-wrap' }}>{activity.payload.content}</div>
          </Row>
          {activity.payload.attachments.length > 0 && (
            <Row label="附件">
              {/* 用户反馈 2026-05-03"各弹窗中的媒体附件也应该一行显示多个缩略图"——flex wrap + 每 item 限宽 160 */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {activity.payload.attachments.map((a) => (
                  <div key={a.id} style={{ width: 160, maxWidth: '100%' }}>
                    <FileItem fileId={a.id} filename={a.filename} />
                  </div>
                ))}
              </div>
            </Row>
          )}
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
          {/* 凭证截图：用户反馈 2026-05-03"结算时间线详情弹窗没有显示结算凭证截图"
           *  后端 0015 migration activity view payment 分支已嵌入 attachments jsonb_agg */}
          {activity.payload.attachments && activity.payload.attachments.length > 0 && (
            <Row label="凭证">
              {/* flex wrap 横向缩略，与 feedback / project_created 媒体区一致 */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {activity.payload.attachments.map((a) => (
                  <div key={a.id} style={{ width: 160, maxWidth: '100%' }}>
                    <FileItem fileId={a.id} filename={a.filename} />
                  </div>
                ))}
              </div>
            </Row>
          )}
        </div>
      );

    case 'status_change': {
      const dwell = formatDwellMs(activity.payload.dwellMs);
      const fromLabel = activity.payload.fromStatus
        ? (PROJECT_STATUS_LABEL[activity.payload.fromStatus] ?? activity.payload.fromStatus)
        : '初始';
      const toLabel =
        PROJECT_STATUS_LABEL[activity.payload.toStatus] ?? activity.payload.toStatus;
      // 当前阶段实时停留：caller 传 now（visibilitychange 触发更新）+ 是 isCurrentStatus 时算
      const currentDwell =
        isCurrentStatus && now !== undefined
          ? formatDwellMs(now - new Date(activity.occurredAt).getTime())
          : '';
      // 拆解 remark：note 是用户文字、fields 是 EventTriggerDialog 拼接的额外结构化字段
      const { note, fields } = parseRemarkFields(activity.payload.remark);
      const fieldEntries = Object.entries(fields);
      return (
        <div className={styles.detailRows}>
          <Row label="时间">{when}</Row>
          <Row label="操作人">{actor}</Row>
          <Row label="状态">
            {fromLabel}
            {' → '}
            {toLabel}
          </Row>
          <Row label="事件">{activity.payload.eventName}（{activity.payload.eventCode}）</Row>
          {currentDwell && (
            <Row label="当前停留">已在「{toLabel}」停留 {currentDwell}</Row>
          )}
          {dwell && activity.payload.fromStatus && (
            <Row label="历史停留">在「{fromLabel}」停留 {dwell}</Row>
          )}
          {note && <Row label="备注">{note}</Row>}
          {fieldEntries.map(([key, value]) => (
            <Row key={key} label={EVENT_FIELD_LABEL[key] ?? key}>{value}</Row>
          ))}
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
            <FileItem fileId={activity.payload.fileId} filename={activity.payload.filename} />
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
            <FileItem fileId={activity.payload.fileId} filename={activity.payload.filename} />
          </Row>
        </div>
      );

    case 'project_created': {
      const { openingDoc, assignmentDoc, wechatChats, developers } = activity.payload;
      return (
        <div className={styles.detailRows}>
          <Row label="时间">{when}</Row>
          <Row label="操作人">{actor}</Row>
          <Row label="项目名">{activity.payload.name}</Row>
          <Row label="初始报价">{formatMoney(activity.payload.originalQuote)}</Row>
          <Row label="优先级">{PROJECT_PRIORITY_LABEL[activity.payload.priority] ?? activity.payload.priority}</Row>
          <Row label="截止时间">{formatWhen(activity.payload.deadline)}</Row>
          {/* 用户反馈 2026-05-03"项目创建详情应该显示对接开发人员字段"
           *  migration 0018 view JOIN project_developers + users 嵌入 displayName */}
          {developers.length > 0 && (
            <Row label="对接开发人员">
              {developers.map((d) => d.displayName).join('、')}
            </Row>
          )}
          {openingDoc && (
            <Row label="开题报告">
              <FileItem fileId={openingDoc.id} filename={openingDoc.filename} />
            </Row>
          )}
          {assignmentDoc && (
            <Row label="任务书">
              <FileItem fileId={assignmentDoc.id} filename={assignmentDoc.filename} />
            </Row>
          )}
          {wechatChats.length > 0 && (
            <Row label="媒体">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {wechatChats.map((f) => (
                  <div key={f.id} style={{ width: 160, maxWidth: '100%' }}>
                    <FileItem fileId={f.id} filename={f.filename} />
                  </div>
                ))}
              </div>
            </Row>
          )}
        </div>
      );
    }
  }
}

const KIND_TITLE: Record<Activity['kind'], string> = {
  project_created: '项目创建详情',
  feedback: '反馈详情',
  status_change: '状态变更详情',
  quote_change: '报价变更详情',
  payment: '结算详情',
  thesis_version: '论文版本详情',
  project_file_added: '附件详情',
};

/** 详情弹窗动态标题。
 *  用户反馈 2026-05-03"报价、开发、验收的时间线弹窗标题应该使用报价/开发/验收详情"
 *  status_change kind 静态"状态变更详情"过于笼统；按 toStatus 取 PROJECT_STATUS_LABEL 拼"X 详情"
 *  非 status_change 走 KIND_TITLE 字典。 */
function resolveKindTitle(activity: Activity): string {
  if (activity.kind === 'status_change') {
    const toStatus = activity.payload.toStatus;
    const toLabel = PROJECT_STATUS_LABEL[toStatus] ?? toStatus;
    return `${toLabel}详情`;
  }
  if (activity.kind === 'project_file_added') {
    const cat = activity.payload.category;
    const catLabel = PROJECT_FILE_CATEGORY_LABEL[cat] ?? cat;
    return `${catLabel}详情`;
  }
  return KIND_TITLE[activity.kind];
}

export function ActivityDetailDialog({ activity, onClose, isCurrentStatus }: Props): ReactElement {
  // useNow：visibilitychange/focus 触发更新（不持续 tick），用于"当前停留"实时计算
  const now = useNow();
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
      aria-label={resolveKindTitle(activity)}
      onClick={onClose}
      className={`${styles.modalOverlay} ${styles.modalOverlayOpen}`}
      data-testid="activity-detail-dialog"
    >
      <div onClick={(e) => e.stopPropagation()} className={styles.modal}>
        <div className={styles.modalHead}>
          <h3>{resolveKindTitle(activity)}</h3>
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
          {renderBody(activity, isCurrentStatus, now)}
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
