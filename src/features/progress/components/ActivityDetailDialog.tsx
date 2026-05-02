/**
 * @file ActivityDetailDialog.tsx
 * @description 时间线条目点击后弹出的详情 modal（用户需求 2026-05-02：
 *              "进度时间线的每条时间线应该都可以点击查看详情"）。
 *
 *              业务流程：
 *              1. DetailTimeline 维护 activeDetail state，点击 ActivityItem 时设置
 *              2. 本组件按 activity.kind 分发渲染对应字段表（key-value 列表）
 *              3. 文件类（thesis_version / project_file_added）渲染下载链接
 *              4. ESC 或点击遮罩关闭
 *
 *              字段映射（按 kind）：
 *              - feedback：actor / source / content / occurredAt
 *              - payment：amount / direction / remark / paidAt
 *              - status_change：from→to / remark
 *              - quote_change：changeType / delta / reason / actor
 *              - thesis_version：version / fileUrl(下载) / actor
 *              - project_file_added：fileName / category / fileUrl(下载) / actor
 *              - project_created：actor / initialQuote
 *
 * @author Atlas.oi
 * @date 2026-05-02
 */
import { useEffect, type ReactElement } from 'react';
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
} from './activityRenderers/shared';
import styles from '../progress.module.css';

interface Props {
  activity: Activity;
  onClose: () => void;
}

/** 单行 key-value 渲染 */
function Row({ label, children }: { label: string; children: React.ReactNode }): ReactElement {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '6px 0', fontSize: 13 }}>
      <span style={{ minWidth: 88, color: 'var(--c-fg-muted, #888)' }}>{label}</span>
      <span style={{ flex: 1, color: 'var(--c-fg, #ddd)', wordBreak: 'break-all' }}>{children}</span>
    </div>
  );
}

/** 文件下载链接 */
function FileLink({ url, name }: { url: string; name?: string }): ReactElement {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: 'var(--c-accent, #79d17c)', textDecoration: 'underline' }}
    >
      {name ?? '打开文件'}
    </a>
  );
}

function renderBody(activity: Activity): ReactElement {
  const actor = formatActor(activity);
  const when = formatWhen(activity.occurredAt);

  switch (activity.kind) {
    case 'feedback':
      return (
        <>
          <Row label="时间">{when}</Row>
          <Row label="操作人">{actor}</Row>
          <Row label="来源">
            {FEEDBACK_SOURCE_LABEL[activity.payload.source] ?? activity.payload.source}
          </Row>
          <Row label="反馈内容">
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{activity.payload.content}</div>
          </Row>
        </>
      );

    case 'payment':
      return (
        <>
          <Row label="时间">{when}</Row>
          <Row label="操作人">{actor}</Row>
          <Row label="方向">
            {PAYMENT_DIRECTION_LABEL[activity.payload.direction] ?? activity.payload.direction}
          </Row>
          <Row label="金额">{formatMoney(activity.payload.amount)}</Row>
          {activity.payload.remark && <Row label="备注">{activity.payload.remark}</Row>}
        </>
      );

    case 'status_change':
      return (
        <>
          <Row label="时间">{when}</Row>
          <Row label="操作人">{actor}</Row>
          <Row label="状态">
            {activity.payload.fromStatus
              ? (PROJECT_STATUS_LABEL[activity.payload.fromStatus] ?? activity.payload.fromStatus)
              : '初始'}
            {' → '}
            {PROJECT_STATUS_LABEL[activity.payload.toStatus] ?? activity.payload.toStatus}
          </Row>
          <Row label="事件">{activity.payload.eventName}（{activity.payload.eventCode}）</Row>
          {activity.payload.remark && <Row label="备注">{activity.payload.remark}</Row>}
        </>
      );

    case 'quote_change':
      return (
        <>
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
        </>
      );

    case 'thesis_version':
      return (
        <>
          <Row label="时间">{when}</Row>
          <Row label="操作人">{actor}</Row>
          <Row label="版本号">v{activity.payload.versionNo}</Row>
          <Row label="文件">
            <FileLink url={`/api/files/${activity.payload.fileId}/download`} name="下载论文版本" />
          </Row>
          {activity.payload.remark && <Row label="备注">{activity.payload.remark}</Row>}
        </>
      );

    case 'project_file_added':
      return (
        <>
          <Row label="时间">{when}</Row>
          <Row label="操作人">{actor}</Row>
          <Row label="类别">
            {PROJECT_FILE_CATEGORY_LABEL[activity.payload.category] ?? activity.payload.category}
          </Row>
          <Row label="文件">
            <FileLink url={`/api/files/${activity.payload.fileId}/download`} name="下载文件" />
          </Row>
        </>
      );

    case 'project_created':
      return (
        <>
          <Row label="时间">{when}</Row>
          <Row label="操作人">{actor}</Row>
          <Row label="项目名">{activity.payload.name}</Row>
          <Row label="初始报价">{formatMoney(activity.payload.originalQuote)}</Row>
          <Row label="优先级">{activity.payload.priority}</Row>
          <Row label="截止时间">{activity.payload.deadline}</Row>
        </>
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
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      data-testid="activity-detail-dialog"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--c-panel, #1a1a18)',
          color: 'var(--c-fg, #ddd)',
          border: '1px solid var(--c-line, #2a2a28)',
          borderRadius: 8,
          padding: 20,
          maxWidth: 540,
          width: 'calc(100% - 32px)',
          maxHeight: 'calc(100vh - 64px)',
          overflowY: 'auto',
          boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
        }}
        className={styles.timelineDetailDialog}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
            paddingBottom: 12,
            borderBottom: '1px solid var(--c-line, #2a2a28)',
          }}
        >
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{KIND_TITLE[activity.kind]}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--c-fg-muted, #888)',
              fontSize: 18,
              lineHeight: 1,
              padding: 4,
            }}
          >
            ×
          </button>
        </div>
        {renderBody(activity)}
      </div>
    </div>
  );
}
