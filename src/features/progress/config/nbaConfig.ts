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
  /** 当 holder_role_id=dev(2) 时改用 devPrimaryAction（仅 quoting 阶段需要） */
  devPrimaryAction?: ActionMeta;
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
  quoting: {
    // 2026-05-04 删 dealing 后：dev 持球时主推"提交报价"(E2)，cs 持球时主推"客户接受报价"(E4)
    defaultReason: '当前处于报价阶段。开发持球时由开发提交报价；客服持球时确认客户反馈。',
    primaryAction: {
      eventCode: 'E4', label: '客户接受报价', modalTitle: '客户接受报价',
      transitionTo: 'developing', meta: '预计 1 分钟', kind: 'primary', permCode: 'event:E4',
      fields: [
        { name: 'prepayment', label: '预付款（¥）', type: 'number', placeholder: '3000' },
        { name: 'note', label: '备注', type: 'textarea' },
      ],
    },
    devPrimaryAction: {
      eventCode: 'E2', label: '提交报价', modalTitle: '提交报价',
      transitionTo: 'quoting', meta: '预计 3 分钟', kind: 'primary', permCode: 'event:E2',
      fields: [
        { name: 'estimatedAmount', label: '预估金额（¥）', type: 'number', placeholder: '8000', required: true },
        { name: 'note', label: '报价说明', type: 'textarea', placeholder: '工作量 / 难度 / 周期', required: true },
      ],
    },
    secondary: [
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
    // 用户反馈 2026-05-03"这里不应该是确认收款而是结算, 这里是客服结算给开发的流程"
    defaultReason: '已交付，建议结算给开发。',
    primaryAction: {
      eventCode: 'E10', label: '结算', modalTitle: '结算',
      transitionTo: 'paid', meta: '预计 1 分钟', kind: 'primary', permCode: 'event:E10',
      // 注：fields 仍保留 amount/method/note，但 ProjectDetailPage 检测到 eventCode==='E10' 时
      // 改弹 PaymentDialog（已支持凭证上传附件，用户原话"点开的结算弹窗应该收上传结算凭证截图入口"），
      // 不再走通用 EventTriggerDialog；PaymentDialog 提交后由 onSuccess 内额外调 triggerEvent E10 推进 status
      fields: [
        { name: 'amount', label: '结算金额（¥）', type: 'number', required: true },
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
    defaultReason: '项目已被取消。如需恢复，可走"重启取消"回到 E12 取消前的状态。',
    primaryAction: {
      eventCode: 'E13', label: '重启取消', modalTitle: '重启取消',
      // transitionTo 仅作为 UI 元数据展示，实际目标由后端读 E12 快照精确还原（任意非终态）
      transitionTo: 'quoting', meta: '预计 1 分钟', kind: 'optional', permCode: 'event:E13',
      fields: [{ name: 'note', label: '重启原因', type: 'textarea', required: true }],
    },
    secondary: [],
  },
};

// ============================================
// Helpers
// ============================================

/**
 * 根据 status + holderRoleId 取出 primary action。
 *
 * 业务规则（2026-05-04）：删 dealing 后 quoting 阶段 holder 在 dev/cs 间循环切换；
 * dev 持球 → 主推"提交报价"(E2)；cs 持球 → 主推"客户接受报价"(E4)。
 *
 * holderRoleId 缺省走 primaryAction（兼容仅 status 入参的旧调用，如看板列头）。
 *
 * status 不在 NBA_CONFIG 中即抛——视为契约破裂，禁止静默 fallback。
 */
export function getPrimaryAction(status: ProjectStatus, holderRoleId?: number | null): ActionMeta {
  const cfg = NBA_CONFIG[status];
  if (!cfg) {
    throw new Error(`getPrimaryAction: 未知 status "${status}"`);
  }
  // role_id=2 即 dev（与后端 statemachine.RoleDev 对齐）
  if (holderRoleId === 2 && cfg.devPrimaryAction) {
    return cfg.devPrimaryAction;
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
    if (cfg.devPrimaryAction && cfg.devPrimaryAction.eventCode === eventCode) return cfg.devPrimaryAction;
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

/** 看板列固定 4 stage（2026-05-04 删 dealing 后；其余 4 个 status 通过详情页/list 视图访问） */
export const KANBAN_STAGES: ProjectStatus[] = ['quoting', 'developing', 'confirming', 'delivered'];

/** Pipeline 6 段（2026-05-04 删 dealing 后；不含 after_sales / cancelled 旁路） */
export const PIPELINE_STAGES: ProjectStatus[] = ['quoting', 'developing', 'confirming', 'delivered', 'paid', 'archived'];

/** 中文 stage label */
export const STATUS_LABEL: Record<ProjectStatus, string> = {
  quoting: '报价',
  developing: '开发',
  confirming: '验收',
  delivered: '交付',
  paid: '结算',
  archived: '归档',
  after_sales: '售后',
  cancelled: '已取消',
};
