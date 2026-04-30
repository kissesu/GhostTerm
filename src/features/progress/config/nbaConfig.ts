/**
 * @file nbaConfig.ts
 * @description Next Best Action 配置：每 ProjectStatus 对应的"建议下一步" CTA、原因、次级动作。
 *              被 NbaPanel / KanbanCard / EventTriggerDialog 共用，避免事件矩阵双源。
 *
 *              业务规则（spec §6.2 + 设计 docs/progress-module-stepper-nba-combined.html）：
 *              - primaryAction：当前 status 下"主推下一步" 1 个事件
 *              - secondary：折叠次级动作（取消 / 拒绝 / 重新洽谈等）
 *              - reason：派生函数，根据 timeline 最近活动天数生成提示文案
 *              - informational：archived / cancelled 终态用，CTA 改"客户报售后/重启"语义
 *
 * @author Atlas.oi
 * @date 2026-04-30
 */
import type { ProjectStatus, EventCode } from '../api/projects';

export interface ActionField {
  label: string;
  type: 'text' | 'number' | 'textarea' | 'select';
  placeholder?: string;
  required?: boolean;
  options?: readonly string[];
  /** zod schema 字段名，默认与 label 同 */
  name: string;
}

export interface ActionMeta {
  eventCode: EventCode;
  /** 中文 CTA 文案 */
  label: string;
  /** modal 标题 */
  modalTitle: string;
  /** 触发后 status 转移目标（来自后端，前端只用于 UI 预览转移链路） */
  transitionTo: ProjectStatus;
  /** 字段配置 */
  fields: readonly ActionField[];
  /** 事件强调级别：primary 主 CTA / optional 次级 / critical 危险动作 */
  kind: 'primary' | 'optional' | 'critical';
  /** 后端权限码 */
  permCode: string;
}

export interface NbaConfig {
  /** 主推下一步动作 */
  primaryAction: ActionMeta;
  /** 折叠次级动作 */
  secondary: readonly ActionMeta[];
  /** 终态特殊样式（archived / cancelled） */
  informational?: boolean;
  /** 默认 reason 文案（无活动数据时） */
  defaultReason: string;
}

/**
 * 派生 reason 文案的入参。
 * 调用方从 timeline / project 数据派生天数；若无数据传 null。
 */
export interface ReasonContext {
  /** 距上次反馈/活动天数；null = 无数据 */
  daysSinceLastActivity: number | null;
  /** 距 deadline 天数；负数 = 已超期 */
  daysToDeadline?: number;
}

// ============================================================================
// 9 status 配置
// ============================================================================

export const NBA_CONFIG: Record<ProjectStatus, NbaConfig> = {
  dealing: {
    defaultReason: '客户已确认论文级别和方向，建议进入报价阶段并填写预估金额。',
    primaryAction: {
      eventCode: 'E1',
      label: '提交报价评估',
      modalTitle: '提交报价评估',
      transitionTo: 'quoting',
      kind: 'primary',
      permCode: 'event:E1',
      fields: [
        { name: 'estimatedAmount', label: '预估金额（¥）', type: 'number', placeholder: '8000', required: true },
        { name: 'note', label: '评估说明', type: 'textarea', placeholder: '工作量 / 难度 / 周期', required: true },
      ],
    },
    secondary: [
      {
        eventCode: 'E12',
        label: '取消项目',
        modalTitle: '取消项目',
        transitionTo: 'cancelled',
        kind: 'critical',
        permCode: 'event:E12',
        fields: [{ name: 'note', label: '取消原因', type: 'textarea', required: true }],
      },
    ],
  },
  quoting: {
    defaultReason: '报价已发送，等待客户回复。',
    primaryAction: {
      eventCode: 'E4',
      label: '客户接受报价',
      modalTitle: '客户接受报价',
      transitionTo: 'developing',
      kind: 'primary',
      permCode: 'event:E4',
      fields: [
        { name: 'prepayment', label: '预付款（¥）', type: 'number', placeholder: '3000' },
        { name: 'note', label: '备注', type: 'textarea' },
      ],
    },
    secondary: [
      {
        eventCode: 'E2',
        label: '评估完成回传',
        modalTitle: '评估完成回传',
        transitionTo: 'developing',
        kind: 'optional',
        permCode: 'event:E2',
        fields: [{ name: 'note', label: '回传备注', type: 'textarea', required: true }],
      },
      {
        eventCode: 'E3',
        label: '再问开发',
        modalTitle: '再问开发',
        transitionTo: 'quoting',
        kind: 'optional',
        permCode: 'event:E3',
        fields: [{ name: 'note', label: '问询内容', type: 'textarea', required: true }],
      },
      {
        eventCode: 'E5',
        label: '客户拒绝报价',
        modalTitle: '客户拒绝报价',
        transitionTo: 'cancelled',
        kind: 'critical',
        permCode: 'event:E5',
        fields: [{ name: 'note', label: '拒绝原因', type: 'textarea', required: true }],
      },
      {
        eventCode: 'E6',
        label: '重新洽谈',
        modalTitle: '重新洽谈',
        transitionTo: 'dealing',
        kind: 'optional',
        permCode: 'event:E6',
        fields: [{ name: 'note', label: '洽谈备注', type: 'textarea', required: true }],
      },
      {
        eventCode: 'E12',
        label: '取消项目',
        modalTitle: '取消项目',
        transitionTo: 'cancelled',
        kind: 'critical',
        permCode: 'event:E12',
        fields: [{ name: 'note', label: '取消原因', type: 'textarea', required: true }],
      },
    ],
  },
  developing: {
    defaultReason: '当前正在开发中。完成后请标记开发完成提交客户验收。',
    primaryAction: {
      eventCode: 'E7',
      label: '标记开发完成',
      modalTitle: '标记开发完成',
      transitionTo: 'confirming',
      kind: 'primary',
      permCode: 'event:E7',
      fields: [
        { name: 'note', label: '交付说明', type: 'textarea', placeholder: '本次交付包含的章节', required: true },
      ],
    },
    secondary: [
      {
        eventCode: 'E12',
        label: '取消项目',
        modalTitle: '取消项目',
        transitionTo: 'cancelled',
        kind: 'critical',
        permCode: 'event:E12',
        fields: [{ name: 'note', label: '取消原因', type: 'textarea', required: true }],
      },
    ],
  },
  confirming: {
    defaultReason: '客户正在验收。验收通过后进入交付阶段。',
    primaryAction: {
      eventCode: 'E9',
      label: '客户验收通过',
      modalTitle: '客户验收通过',
      transitionTo: 'delivered',
      kind: 'primary',
      permCode: 'event:E9',
      fields: [{ name: 'note', label: '验收备注', type: 'textarea' }],
    },
    secondary: [
      {
        eventCode: 'E8',
        label: '客户要修改',
        modalTitle: '客户要修改',
        transitionTo: 'developing',
        kind: 'optional',
        permCode: 'event:E8',
        fields: [{ name: 'note', label: '修改要求', type: 'textarea', required: true }],
      },
      {
        eventCode: 'E12',
        label: '取消项目',
        modalTitle: '取消项目',
        transitionTo: 'cancelled',
        kind: 'critical',
        permCode: 'event:E12',
        fields: [{ name: 'note', label: '取消原因', type: 'textarea', required: true }],
      },
    ],
  },
  delivered: {
    defaultReason: '已交付，建议催收尾款。',
    primaryAction: {
      eventCode: 'E10',
      label: '确认收款',
      modalTitle: '确认收款',
      transitionTo: 'paid',
      kind: 'primary',
      permCode: 'event:E10',
      fields: [
        { name: 'amount', label: '收款金额（¥）', type: 'number', required: true },
        { name: 'method', label: '支付方式', type: 'select', options: ['支付宝', '微信', '银行转账', '现金', '其他'], required: true },
        { name: 'note', label: '备注', type: 'textarea' },
      ],
    },
    secondary: [
      {
        eventCode: 'E12',
        label: '取消项目',
        modalTitle: '取消项目',
        transitionTo: 'cancelled',
        kind: 'critical',
        permCode: 'event:E12',
        fields: [{ name: 'note', label: '取消原因', type: 'textarea', required: true }],
      },
    ],
  },
  paid: {
    defaultReason: '尾款已结清，建议归档项目。',
    primaryAction: {
      eventCode: 'E11',
      label: '归档项目',
      modalTitle: '归档项目',
      transitionTo: 'archived',
      kind: 'primary',
      permCode: 'event:E11',
      fields: [{ name: 'note', label: '归档总结', type: 'textarea' }],
    },
    secondary: [],
  },
  archived: {
    informational: true,
    defaultReason: '项目已归档。如客户后续报售后，可走"客户报售后"启动售后流转。',
    primaryAction: {
      eventCode: 'E_AS1',
      label: '客户报售后',
      modalTitle: '客户报售后',
      transitionTo: 'after_sales',
      kind: 'optional',
      permCode: 'event:E_AS1',
      fields: [
        { name: 'note', label: '售后说明', type: 'textarea', placeholder: '客户反馈的问题', required: true },
      ],
    },
    secondary: [],
  },
  after_sales: {
    defaultReason: '正在处理售后。处理完毕后请标记售后已结束。',
    primaryAction: {
      eventCode: 'E_AS3',
      label: '售后已结束',
      modalTitle: '售后已结束',
      transitionTo: 'archived',
      kind: 'primary',
      permCode: 'event:E_AS3',
      fields: [{ name: 'note', label: '售后总结', type: 'textarea', required: true }],
    },
    secondary: [],
  },
  cancelled: {
    informational: true,
    defaultReason: '项目已被取消。如需恢复，可走"重启取消"回到洽谈状态。',
    primaryAction: {
      eventCode: 'E13',
      label: '重启取消',
      modalTitle: '重启取消',
      transitionTo: 'dealing',
      kind: 'optional',
      permCode: 'event:E13',
      fields: [{ name: 'note', label: '重启原因', type: 'textarea', required: true }],
    },
    secondary: [],
  },
};

// ============================================================================
// 派生函数
// ============================================================================

/**
 * 获取 status 的主推动作。
 *
 * @throws Error 如果 status 不在 NBA_CONFIG（防御性，正常调用永远不会触发）
 */
export function getPrimaryAction(status: ProjectStatus): ActionMeta {
  const cfg = NBA_CONFIG[status];
  if (!cfg) {
    throw new Error(`getPrimaryAction: 未知 status "${status}"`);
  }
  return cfg.primaryAction;
}

/**
 * 派生 NBA reason 文案。
 *
 * 业务规则（基于 timeline 最近活动派生）：
 *  - developing: 5 天无反馈 → "建议催进度 / 催客户回复"
 *  - confirming: 3 天无回复 → "建议提醒客户验收"
 *  - delivered:  3 天未收款 → "建议催收尾款"
 *  - 其它 status / 无数据：返回 NBA_CONFIG.defaultReason
 *
 * @param status 当前项目 status
 * @param ctx 派生上下文（最近活动天数 / deadline 天数）
 */
export function deriveReason(status: ProjectStatus, ctx: ReasonContext): string {
  const def = NBA_CONFIG[status]?.defaultReason ?? '';
  const days = ctx.daysSinceLastActivity;

  if (days === null) return def;

  if (status === 'developing' && days >= 5) {
    return '已 ' + days + ' 天无新反馈或活动，建议主动联系客户催进度或确认下一步。';
  }
  if (status === 'confirming' && days >= 3) {
    return '已交客户验收 ' + days + ' 天未回复，建议主动提醒客户验收。';
  }
  if (status === 'delivered' && days >= 3) {
    return '已交付 ' + days + ' 天未收到尾款，建议催收。';
  }

  return def;
}
