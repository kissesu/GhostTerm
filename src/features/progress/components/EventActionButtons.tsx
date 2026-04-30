/**
 * @file EventActionButtons.tsx
 * @description 项目状态机事件按钮面板（Phase 11）。
 *
 *              业务规则（spec §6.2 完整事件矩阵）：
 *              - 列出当前 status 下"合法"事件（按 from_status 过滤）
 *              - 每个按钮被 PermissionGate 包裹（事件触发权限码 event:E*）
 *              - 点击按钮 → 打开 EventTriggerDialog 收集 note 并提交
 *              - E12 取消：任意非终态都可以触发；E13 重启：仅 cancelled 状态可触发
 *
 *              不在本组件做：
 *              - 不调后端 /api/projects/{id}/available-events：
 *                spec 没有该 endpoint；事件矩阵稳定，前端硬编码即可
 *                后端 /api/projects/{id}/events 仍是真实裁决方
 *              - 不做角色校验：UI 用 PermissionGate 兜底，后端 RequirePerm 是终审
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { useState, type ReactElement } from 'react';

import type { EventCode, ProjectStatus } from '../api/projects';
import { PermissionGate } from './PermissionGate';
import { EventTriggerDialog } from './EventTriggerDialog';

interface EventActionButtonsProps {
  /** 关联项目 id */
  projectId: number;
  /** 当前项目状态（决定哪些事件可触发） */
  status: ProjectStatus;
  /** 事件触发成功回调（caller 决定是否 toast / refresh detail） */
  onEventTriggered?: () => void;
}

/**
 * 事件元数据：可触发该事件的"前置状态" + 中文标签 + 权限码。
 *
 * 业务背景（spec §6.2）：
 *  - applicableStatuses: 哪些 status 下显示该按钮
 *  - permCode: 后端要求的权限码 event:E*
 *  - label: 按钮文案（中文）
 *
 * E12 / E13 是特例：
 *  - E12（取消）：除 cancelled / archived 终态外任何状态都可触发 → 用 'any-active' 标记
 *  - E13（重启）：仅 cancelled 触发 → 用 'cancelled' 单一前置
 */
interface EventMeta {
  code: EventCode;
  label: string;
  permCode: string;
  /**
   * 适用前置状态。
   * 'any-active' = 除 cancelled / archived 外都允许（E12 专用）
   */
  applicableStatuses: ProjectStatus[] | 'any-active';
}

/**
 * 13 个事件矩阵（spec §6.2 + E_AS1 / E_AS3 售后流转）。
 *
 * 顺序按状态机推进顺序排列；UI 自然按业务流程读起来顺畅。
 */
const EVENT_MATRIX: ReadonlyArray<EventMeta> = [
  // 洽谈 → 报价
  { code: 'E1', label: '提交报价评估', permCode: 'event:E1', applicableStatuses: ['dealing'] },
  // 报价回传 / 再问
  { code: 'E2', label: '评估完成回传', permCode: 'event:E2', applicableStatuses: ['quoting'] },
  { code: 'E3', label: '再问开发', permCode: 'event:E3', applicableStatuses: ['quoting'] },
  // 客户决定
  { code: 'E4', label: '客户接受报价', permCode: 'event:E4', applicableStatuses: ['quoting'] },
  { code: 'E5', label: '客户拒绝报价', permCode: 'event:E5', applicableStatuses: ['quoting'] },
  { code: 'E6', label: '重新洽谈', permCode: 'event:E6', applicableStatuses: ['quoting'] },
  // 开发流程
  { code: 'E7', label: '开发完成', permCode: 'event:E7', applicableStatuses: ['developing'] },
  { code: 'E8', label: '客户要修改', permCode: 'event:E8', applicableStatuses: ['confirming'] },
  { code: 'E9', label: '客户验收通过', permCode: 'event:E9', applicableStatuses: ['confirming'] },
  // 收款 / 归档
  { code: 'E10', label: '确认收款', permCode: 'event:E10', applicableStatuses: ['delivered'] },
  { code: 'E11', label: '归档', permCode: 'event:E11', applicableStatuses: ['paid'] },
  // 售后
  { code: 'E_AS1', label: '客户报售后', permCode: 'event:E_AS1', applicableStatuses: ['archived'] },
  { code: 'E_AS3', label: '售后已结束', permCode: 'event:E_AS3', applicableStatuses: ['after_sales'] },
  // 取消 / 重启（特例）
  { code: 'E12', label: '取消项目', permCode: 'event:E12', applicableStatuses: 'any-active' },
  { code: 'E13', label: '重启取消', permCode: 'event:E13', applicableStatuses: ['cancelled'] },
];

/**
 * 判定某事件在当前 status 下是否可触发。
 *
 * 业务规则：
 *  - 'any-active' 列表 = cancelled/archived 外的任何状态
 *  - 数组列表 = 精确匹配
 */
function isEventApplicable(meta: EventMeta, status: ProjectStatus): boolean {
  if (meta.applicableStatuses === 'any-active') {
    return status !== 'cancelled' && status !== 'archived';
  }
  return meta.applicableStatuses.includes(status);
}

export function EventActionButtons({
  projectId,
  status,
  onEventTriggered,
}: EventActionButtonsProps): ReactElement {
  // 当前打开的事件弹窗（null = 没打开任何弹窗）
  const [activeEvent, setActiveEvent] = useState<EventMeta | null>(null);

  // 过滤当前 status 下可触发的事件
  const applicableEvents = EVENT_MATRIX.filter((m) => isEventApplicable(m, status));

  if (applicableEvents.length === 0) {
    return (
      <div
        data-testid="event-action-buttons-empty"
        style={{
          padding: 14,
          fontSize: 12,
          color: 'var(--faint)',
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          borderRadius: 8,
        }}
      >
        当前状态下无可触发事件
      </div>
    );
  }

  return (
    <div
      data-testid="event-action-buttons"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 14,
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: 8,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: 'var(--faint)',
          marginBottom: 4,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
        }}
      >
        可触发事件
      </div>

      {applicableEvents.map((meta) => (
        <PermissionGate key={meta.code} perm={meta.permCode}>
          <button
            type="button"
            onClick={() => setActiveEvent(meta)}
            data-testid={`event-action-${meta.code}`}
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid var(--line)',
              background: 'var(--panel-2)',
              color: 'var(--text)',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              textAlign: 'left',
              fontFamily: 'inherit',
            }}
          >
            <span
              style={{
                fontFamily: 'JetBrains Mono, SF Mono, monospace',
                color: 'var(--accent)',
                marginRight: 8,
                fontWeight: 800,
                fontSize: 11,
              }}
            >
              {meta.code}
            </span>
            {meta.label}
          </button>
        </PermissionGate>
      ))}

      {activeEvent !== null && (
        <div
          data-testid="event-action-modal-overlay"
          // 用最简模态背景：fixed + 遮罩；按 Escape 由 EventTriggerDialog 自行处理
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(5, 5, 4, 0.55)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 24,
          }}
          onClick={(e) => {
            // 点击遮罩外（背景）关闭；点击对话框内不冒泡
            if (e.target === e.currentTarget) {
              setActiveEvent(null);
            }
          }}
        >
          <EventTriggerDialog
            projectId={projectId}
            event={activeEvent.code}
            eventLabel={activeEvent.label}
            onClose={() => setActiveEvent(null)}
            onSuccess={onEventTriggered}
          />
        </div>
      )}
    </div>
  );
}
