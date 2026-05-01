/**
 * @file nbaConfig.ts
 * @description Next Best Action 配置 - 9 个 ProjectStatus 各对应主推 + 折叠次级 + reason 派生
 *              视觉契约见 docs/progress-module-stepper-nba-combined.html line 590-633（5 stage 演示版）
 *              本配置扩展到 9 status：5 个活跃 stage 完整 NBA + 4 个特殊 status（paid/archived/after_sales/cancelled）
 *              archived/cancelled 标 informational=true（视觉弱化）
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import type { ProjectStatus, EventCode } from '../api/projects';

// ============================================
// 类型定义
// ============================================

/** 单字段定义；EventTriggerDialog 据此渲染输入控件 */
export interface ActionField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'textarea' | 'select';
  placeholder?: string;
  required?: boolean;
  options?: readonly string[];
}

/** 一个动作的完整元数据；NBA primary 与 secondary 共用 */
export interface ActionMeta {
  eventCode: EventCode;
  label: string;
  modalTitle: string;
  transitionTo: ProjectStatus;
  meta: string; // 设计稿"预计 X 分钟"
  kind: 'primary' | 'optional' | 'critical';
  permCode: string; // event:E1 等
  fields: readonly ActionField[];
}

/** 单 status 的 NBA 配置 */
export interface NbaConfig {
  primaryAction: ActionMeta;
  secondary: readonly ActionMeta[];
  defaultReason: string;
  /** archived / cancelled 等"非活跃"状态 → NbaPanel 视觉弱化 */
  informational?: boolean;
}

/** deriveReason 入参 */
export interface ReasonContext {
  daysSinceLastActivity: number | null;
  daysToDeadline?: number;
}

// ============================================
// 9 status × NBA 主次表（plan §1.1 决策预存清单）
// ============================================

export const NBA_CONFIG: Record<ProjectStatus, NbaConfig> = {
  dealing: {
    defaultReason: '客户已确认论文级别和方向，建议进入报价。',
    primaryAction: {
      eventCode: 'E1', label: '提交报价评估', modalTitle: '提交报价评估',
      transitionTo: 'quoting', meta: '预计 3 分钟', kind: 'primary', permCode: 'event:E1',
      fields: [
        { name: 'estimatedAmount', label: '预估金额（¥）', type: 'number', placeholder: '8000', required: true },
        { name: 'note', label: '评估说明', type: 'textarea', placeholder: '工作量 / 难度 / 周期', required: true },
      ],
    },
    secondary: [
      {
        eventCode: 'E12', label: '取消项目', modalTitle: '取消项目',
        transitionTo: 'cancelled', meta: '预计 1 分钟', kind: 'critical', permCode: 'event:E12',
        fields: [{ name: 'note', label: '取消原因', type: 'textarea', required: true }],
      },
    ],
  },
  quoting: {
    defaultReason: '报价已发送，客户回复同意。建议确认进入开发。',
    primaryAction: {
      eventCode: 'E4', label: '客户接受报价', modalTitle: '客户接受报价',
      transitionTo: 'developing', meta: '预计 1 分钟', kind: 'primary', permCode: 'event:E4',
      fields: [
        { name: 'prepayment', label: '预付款（¥）', type: 'number', placeholder: '3000' },
        { name: 'note', label: '备注', type: 'textarea' },
      ],
    },
    secondary: [
      {
        eventCode: 'E2', label: '评估完成回传', modalTitle: '评估完成回传',
        transitionTo: 'developing', meta: '预计 2 分钟', kind: 'optional', permCode: 'event:E2',
        fields: [{ name: 'note', label: '回传备注', type: 'textarea', required: true }],
      },
      {
        eventCode: 'E3', label: '再问开发', modalTitle: '再问开发',
        transitionTo: 'quoting', meta: '预计 1 分钟', kind: 'optional', permCode: 'event:E3',
        fields: [{ name: 'note', label: '问询内容', type: 'textarea', required: true }],
      },
      {
        eventCode: 'E5', label: '客户拒绝报价', modalTitle: '客户拒绝报价',
        transitionTo: 'cancelled', meta: '预计 1 分钟', kind: 'critical', permCode: 'event:E5',
        fields: [{ name: 'note', label: '拒绝原因', type: 'textarea', required: true }],
      },
      {
        eventCode: 'E6', label: '重新洽谈', modalTitle: '重新洽谈',
        transitionTo: 'dealing', meta: '预计 2 分钟', kind: 'optional', permCode: 'event:E6',
        fields: [{ name: 'note', label: '洽谈备注', type: 'textarea', required: true }],
      },
      {
        eventCode: 'E12', label: '取消项目', modalTitle: '取消项目',
        transitionTo: 'cancelled', meta: '预计 1 分钟', kind: 'critical', permCode: 'event:E12',
        fields: [{ name: 'note', label: '取消原因', type: 'textarea', required: true }],
      },
    ],
  },
  developing: {
    defaultReason: '当前正在开发。完成后请标记开发完成提交客户验收。',
    primaryAction: {
      eventCode: 'E7', label: '标记开发完成', modalTitle: '标记开发完成',
      transitionTo: 'confirming', meta: '预计 2 分钟', kind: 'primary', permCode: 'event:E7',
      fields: [
        { name: 'note', label: '交付说明', type: 'textarea', placeholder: '本次交付包含哪些章节', required: true },
      ],
    },
    secondary: [
      {
        eventCode: 'E12', label: '取消项目', modalTitle: '取消项目',
        transitionTo: 'cancelled', meta: '预计 1 分钟', kind: 'critical', permCode: 'event:E12',
        fields: [{ name: 'note', label: '取消原因', type: 'textarea', required: true }],
      },
    ],
  },
  confirming: {
    defaultReason: '客户正在验收。验收通过后进入交付阶段。',
    primaryAction: {
      eventCode: 'E9', label: '客户验收通过', modalTitle: '客户验收通过',
      transitionTo: 'delivered', meta: '预计 1 分钟', kind: 'primary', permCode: 'event:E9',
      fields: [{ name: 'note', label: '验收备注', type: 'textarea', placeholder: '客户最终反馈' }],
    },
    secondary: [
      {
        eventCode: 'E8', label: '客户要修改', modalTitle: '客户要修改',
        transitionTo: 'developing', meta: '预计 1 分钟', kind: 'optional', permCode: 'event:E8',
        fields: [{ name: 'note', label: '修改要求', type: 'textarea', required: true }],
      },
      {
        eventCode: 'E12', label: '取消项目', modalTitle: '取消项目',
        transitionTo: 'cancelled', meta: '预计 1 分钟', kind: 'critical', permCode: 'event:E12',
        fields: [{ name: 'note', label: '取消原因', type: 'textarea', required: true }],
      },
    ],
  },
  delivered: {
    defaultReason: '已交付，建议催收尾款。',
    primaryAction: {
      eventCode: 'E10', label: '确认收款', modalTitle: '确认收款',
      transitionTo: 'paid', meta: '预计 1 分钟', kind: 'primary', permCode: 'event:E10',
      fields: [
        { name: 'amount', label: '收款金额（¥）', type: 'number', required: true },
        { name: 'method', label: '支付方式', type: 'select', options: ['支付宝', '微信', '银行转账', '现金', '其他'], required: true },
        { name: 'note', label: '备注', type: 'textarea' },
      ],
    },
    secondary: [
      {
        eventCode: 'E12', label: '取消项目', modalTitle: '取消项目',
        transitionTo: 'cancelled', meta: '预计 1 分钟', kind: 'critical', permCode: 'event:E12',
        fields: [{ name: 'note', label: '取消原因', type: 'textarea', required: true }],
      },
    ],
  },
  paid: {
    defaultReason: '尾款已结清，建议归档项目。',
    primaryAction: {
      eventCode: 'E11', label: '归档项目', modalTitle: '归档项目',
      transitionTo: 'archived', meta: '预计 1 分钟', kind: 'primary', permCode: 'event:E11',
      fields: [{ name: 'note', label: '归档总结', type: 'textarea' }],
    },
    secondary: [],
  },
  archived: {
    informational: true,
    defaultReason: '项目已归档。如客户后续报售后，可走"客户报售后"启动售后流转。',
    primaryAction: {
      eventCode: 'E_AS1', label: '客户报售后', modalTitle: '客户报售后',
      transitionTo: 'after_sales', meta: '预计 2 分钟', kind: 'optional', permCode: 'event:E_AS1',
      fields: [
        { name: 'note', label: '售后说明', type: 'textarea', placeholder: '客户反馈的问题', required: true },
      ],
    },
    secondary: [],
  },
  after_sales: {
    defaultReason: '正在处理售后。处理完毕后请标记售后已结束。',
    primaryAction: {
      eventCode: 'E_AS3', label: '售后已结束', modalTitle: '售后已结束',
      transitionTo: 'archived', meta: '预计 1 分钟', kind: 'primary', permCode: 'event:E_AS3',
      fields: [{ name: 'note', label: '售后总结', type: 'textarea', required: true }],
    },
    secondary: [],
  },
  cancelled: {
    informational: true,
    defaultReason: '项目已被取消。如需恢复，可走"重启取消"回到洽谈状态。',
    primaryAction: {
      eventCode: 'E13', label: '重启取消', modalTitle: '重启取消',
      transitionTo: 'dealing', meta: '预计 1 分钟', kind: 'optional', permCode: 'event:E13',
      fields: [{ name: 'note', label: '重启原因', type: 'textarea', required: true }],
    },
    secondary: [],
  },
};

// ============================================
// Helpers
// ============================================

/**
 * 根据 status 取出 primary action（NbaPanel 主推按钮调用）。
 * status 不在 NBA_CONFIG 中即抛——视为契约破裂，禁止静默 fallback。
 */
export function getPrimaryAction(status: ProjectStatus): ActionMeta {
  const cfg = NBA_CONFIG[status];
  if (!cfg) {
    throw new Error(`getPrimaryAction: 未知 status "${status}"`);
  }
  return cfg.primaryAction;
}

/**
 * 反查 ActionMeta（用于 EventTriggerDialog 通过 eventCode 找到 fields/transitionTo 等元数据）
 *
 * 注意：同一 eventCode 可能在多个 status 出现（如 E12 在 5 个活跃 status 都是 secondary），
 * 但其 fields / modalTitle 等元数据完全一致，所以返回首个匹配即可。
 */
export function findActionMeta(eventCode: EventCode): ActionMeta | null {
  for (const cfg of Object.values(NBA_CONFIG)) {
    if (cfg.primaryAction.eventCode === eventCode) return cfg.primaryAction;
    const sec = cfg.secondary.find((s) => s.eventCode === eventCode);
    if (sec) return sec;
  }
  return null;
}

/**
 * 派生 reason 文案
 *
 * 业务规则：
 * 1. days===null 或 NaN/Infinity → defaultReason
 * 2. developing + days >= 5 → "已 X 天无新反馈或活动，建议主动联系客户催进度或确认下一步。"
 * 3. confirming + days >= 3 → "已交客户验收 X 天未回复，建议主动提醒客户验收。"
 * 4. delivered + days >= 3 → "已交付 X 天未收到尾款，建议催收。"
 * 5. 其它 → defaultReason
 */
export function deriveReason(status: ProjectStatus, ctx: ReasonContext): string {
  const def = NBA_CONFIG[status]?.defaultReason ?? '';
  const days = ctx.daysSinceLastActivity;
  if (days === null || !Number.isFinite(days)) return def;

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

// ============================================
// 视图常量
// ============================================

/** 看板列固定 5 stage（设计稿决策；其余 4 个 status 通过详情页/list 视图访问） */
export const KANBAN_STAGES: ProjectStatus[] = ['dealing', 'quoting', 'developing', 'confirming', 'delivered'];

/** Pipeline 7 段（设计稿 line 573；不含 after_sales / cancelled 旁路） */
export const PIPELINE_STAGES: ProjectStatus[] = ['dealing', 'quoting', 'developing', 'confirming', 'delivered', 'paid', 'archived'];

/** 中文 stage label（设计稿 line 569-572） */
export const STATUS_LABEL: Record<ProjectStatus, string> = {
  dealing: '洽谈',
  quoting: '报价',
  developing: '开发中',
  confirming: '验收',
  delivered: '已交付',
  paid: '已收款',
  archived: '已归档',
  after_sales: '售后',
  cancelled: '已取消',
};
