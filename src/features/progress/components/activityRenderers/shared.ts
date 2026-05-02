/**
 * @file shared.ts
 * @description 7 类活动渲染器共享 label 映射 + 时间/actor 格式化
 *
 *              业务逻辑说明：
 *              1. label 映射全部来自 OAS 枚举值；后端补字段时这里同步追加，不做兜底
 *              2. formatWhen 三档：今天 HH:MM / 昨天 HH:MM / MM/DD HH:MM
 *              3. formatActor 在 actorRoleName 存在时拼角色括号，缺失角色只用名字
 *              4. formatMoney 强制 toFixed(2)，避免后端 decimal 字符串格式漂移
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */

/** 反馈来源（feedback.payload.source）label 映射 */
export const FEEDBACK_SOURCE_LABEL: Record<string, string> = {
  phone: '电话',
  wechat: '微信',
  email: '邮件',
  meeting: '会面',
  other: '其他',
};

/** 收/付款方向（payment.payload.direction）label 映射 */
export const PAYMENT_DIRECTION_LABEL: Record<string, string> = {
  customer_in: '客户收款',
  dev_settlement: '开发结算',
};

/** 项目状态（status_change.payload.fromStatus / toStatus）label 映射 */
export const PROJECT_STATUS_LABEL: Record<string, string> = {
  dealing: '洽谈中',
  quoting: '报价中',
  developing: '开发中',
  confirming: '验收中',
  delivered: '已交付',
  paid: '已收款',
  archived: '已归档',
  after_sales: '售后中',
  cancelled: '已取消',
};

/** 报价调整类型（quote_change.payload.changeType）label 映射 */
export const QUOTE_CHANGE_TYPE_LABEL: Record<string, string> = {
  append: '追加',
  modify: '调整',
  after_sales: '售后',
};

/** 项目附件类别（project_file_added.payload.category）label 映射 */
export const PROJECT_FILE_CATEGORY_LABEL: Record<string, string> = {
  sample_doc: '参考样稿',
  source_code: '源码',
};

/**
 * 把 ISO 时间字符串格式化为 `YYYY-MM-DD HH:mm`（用户需求 2026-05-02：
 * "每条时间线的时间应该显示为 YYYY-MM-DD HH:mm"，统一格式不再"今天/昨天"相对时间，
 * 让审计 / 排查更直观）。
 *
 * @param iso ISO 8601 时间字符串
 */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  const yyyy = d.getFullYear().toString();
  const mo = (d.getMonth() + 1).toString().padStart(2, '0');
  const dd = d.getDate().toString().padStart(2, '0');
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${yyyy}-${mo}-${dd} ${hh}:${mm}`;
}

/**
 * 格式化 actor 显示名：`{name}（{role}）` 或 `{name}`
 *
 * 业务逻辑说明：
 * - actorName 缺失时回退到 "未知"（活动可能由历史用户产生，role 已删除）
 * - actorRoleName 存在才加括号，避免 "未知（）" 这种空括号
 */
export function formatActor(a: {
  actorName?: string | null;
  actorRoleName?: string | null;
}): string {
  const name = a.actorName ?? '未知';
  if (a.actorRoleName) return `${name}（${a.actorRoleName}）`;
  return name;
}

/**
 * 格式化金额字符串为 ¥X.XX 显示。
 *
 * 后端 Money 字段统一为 decimal(N,2) 字符串；前端必须 toFixed(2) 以
 * 防 "5000" 直传被认为没有小数位。NaN 兜底直接返回原字符串。
 */
export function formatMoney(s: string): string {
  const n = Number(s);
  if (Number.isNaN(n)) return s;
  return `¥${n.toFixed(2)}`;
}
