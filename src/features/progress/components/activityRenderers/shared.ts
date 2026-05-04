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

/** 项目优先级（project_created.payload.priority 等）label 映射。
 *  用户反馈 2026-05-03"项目创建详情的优先级不能使用英文"——normal/urgent → 普通/紧急 */
export const PROJECT_PRIORITY_LABEL: Record<string, string> = {
  normal: '普通',
  urgent: '紧急',
};

/** 项目状态（status_change.payload.fromStatus / toStatus）label 映射。
 *  用户反馈 2026-05-03"文案描述不要加'中'这个字符"——4 处进行中态去"中"，
 *  与 nbaConfig.STATUS_LABEL（PipelineStepper 用）保持文案一致。 */
export const PROJECT_STATUS_LABEL: Record<string, string> = {
  dealing: '洽谈',
  quoting: '报价',
  developing: '开发',
  confirming: '验收',
  delivered: '已交付',
  paid: '已结算',
  archived: '已归档',
  after_sales: '售后',
  cancelled: '已取消',
};

/** 报价调整类型（quote_change.payload.changeType）label 映射 */
export const QUOTE_CHANGE_TYPE_LABEL: Record<string, string> = {
  append: '追加',
  modify: '调整',
  after_sales: '售后',
};

/** 项目附件类别（project_file_added.payload.category）label 映射
 *  与后端 DB CHECK 保持一致：sample_doc / source_code (0001) + wechat_chat (0004) */
export const PROJECT_FILE_CATEGORY_LABEL: Record<string, string> = {
  sample_doc: '参考样稿',
  source_code: '源码',
  wechat_chat: '微信聊天截图',
};

/** EventTriggerDialog [fields] JSON 字段名 → 中文 label
 *  来源：nbaConfig.ts 各事件 form fields；新加事件字段时同步补本表，否则备注行将显示英文 key */
export const EVENT_FIELD_LABEL: Record<string, string> = {
  // 用户反馈 2026-05-03"报价时间线详情的预估进度应该改为报价"——
  // estimatedAmount 在 quoting 事件下记录的就是报价金额，文案与 PipelineStepper 一致
  estimatedAmount: '报价（¥）',
  prepayment: '预付款（¥）',
  amount: '结算金额（¥）',
  method: '支付方式',
};

/**
 * 拆解 EventTriggerDialog 拼接的 remark：
 *   "note 文字\n[fields]{"estimatedAmount":"800",...}"
 * 还原为人类可读的 note + 结构化 fields map。
 *
 * 业务背景（用户反馈 2026-05-03）："为什么会出现 [fields\"estimatedAmount\": \"800\")?"
 * 后端 status_change_logs.remark 是单 string 字段，前端 EventTriggerDialog 把多 form 字段
 * 拼成"note + [fields]JSON"塞进去。详情弹窗渲染时必须拆开，不能直接 textContent。
 *
 * 解析规则：
 *   - 找 "[fields]" 标记：之前是 note，之后是 JSON
 *   - JSON.parse 失败 / 标记缺失 → fields 空 + note 是整个 remark（向后兼容老数据）
 *   - note 末尾 \n 去掉
 */
export function parseRemarkFields(remark: string | null | undefined): {
  note: string;
  fields: Record<string, string>;
} {
  if (!remark) return { note: '', fields: {} };
  const idx = remark.indexOf('[fields]');
  if (idx < 0) return { note: remark, fields: {} };
  const note = remark.slice(0, idx).replace(/\n$/, '');
  const jsonStr = remark.slice(idx + '[fields]'.length);
  try {
    const fields = JSON.parse(jsonStr) as Record<string, string>;
    return { note, fields };
  } catch {
    return { note: remark, fields: {} };
  }
}

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
 * 格式化 actor 账号串：`{display_name} @{username}` 用于 chip 行右侧紧凑显示。
 *
 * 业务背景（用户原话 2026-05-03）："需要在反馈、状态、创建 tag 右侧显示提交当前
 * 时间线的用户账号的功能, 这样时间线信息才完整。"
 *
 * 业务逻辑说明：
 * - displayName 缺失（actor 用户被删）→ 用 "未知" 占位，不显示 @username
 * - username 缺失（同上 / 老数据）→ 仅显示 displayName 不带 @
 * - 二者都有 → "超级管理员 @admin" 形式（GitHub/Slack/Linear 标准排版）
 */
export function formatActorWithAccount(a: {
  actorName?: string | null;
  actorUsername?: string | null;
}): string {
  const name = a.actorName ?? '未知';
  if (a.actorUsername) return `${name} @${a.actorUsername}`;
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

/**
 * 把 User-Agent 字符串提取平台名（macOS/Windows/Linux/iOS/Android/其它）。
 *
 * 业务背景（用户反馈 2026-05-03）："时间线详情的设备只显示平台就可以了"
 * 完整 UA 字符串太长（"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/..."）
 * 只展示平台让审计列表清爽。
 */
export function parseUserAgentPlatform(ua: string | null | undefined): string {
  if (!ua) return '';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh|Mac OS X/.test(ua)) return 'macOS';
  if (/Windows NT/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return '其它';
}

/**
 * 客户端 IP 归一化：::1 → 127.0.0.1；::ffff:192.168.1.1 → 192.168.1.1。
 *
 * 业务背景（用户反馈 2026-05-03）："IP字段显示用户真实的 IPv4 地址"
 * 后端 middleware/metadata.go 已加同款归一化覆盖**新写入**的活动；本前端 helper
 * 兜底**已存在的历史活动**（client_ip 列仍是 ::1），让详情弹窗统一显示 IPv4 形式。
 */
export function normalizeClientIp(ip: string | null | undefined): string {
  if (!ip) return '';
  if (ip === '::1') return '127.0.0.1';
  const m = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (m) return m[1];
  return ip;
}

/** 媒体类扩展名（图片 + 视频） */
const MEDIA_EXTS = new Set([
  // 图片
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'avif', 'svg', 'bmp', 'tiff', 'tif', 'ico',
  // 视频
  'mp4', 'mov', 'webm', 'avi', 'mkv', 'wmv', 'flv', 'm4v',
]);

/** 文档类扩展名（PDF + Office + 文本 + 压缩包） */
const DOCUMENT_EXTS = new Set([
  // PDF / Office
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  // 文本
  'txt', 'md', 'csv', 'rtf',
  // OpenDocument
  'odt', 'ods', 'odp',
  // 压缩包
  'zip', 'rar', '7z', 'tar', 'gz',
]);

/** 单文件按扩展名归类为 'media' / 'doc' / 'other' */
function categorizeFile(filename: string): 'media' | 'doc' | 'other' {
  const idx = filename.lastIndexOf('.');
  if (idx <= 0 || idx >= filename.length - 1) return 'other';
  const ext = filename.slice(idx + 1).toLowerCase();
  if (MEDIA_EXTS.has(ext)) return 'media';
  if (DOCUMENT_EXTS.has(ext)) return 'doc';
  return 'other';
}

/**
 * 按媒体/文档两类聚合附件计数 → "2 个媒体、1 个文档"。
 *
 * 业务背景（用户反馈 2026-05-03）："进度功能模块应该只有两类文件, 媒体、文档,
 * 那么时间线就显示 *个媒体, *个文档附件"——替代之前按扩展名详细列出的 .png ×2 .pdf。
 *
 * 规则：
 *  - 媒体 = 图片 + 视频；文档 = PDF/Office/文本/压缩包
 *  - 0 类不显示对应 segment
 *  - 'other' 仅当存在时才显示，避免常态噪音
 *  - 空数组返回空串
 */
export function summarizeAttachmentCategories(files: { filename: string }[]): string {
  if (files.length === 0) return '';
  const counts = { media: 0, doc: 0, other: 0 };
  for (const f of files) counts[categorizeFile(f.filename)]++;
  const parts: string[] = [];
  if (counts.media > 0) parts.push(`${counts.media} 个媒体`);
  if (counts.doc > 0) parts.push(`${counts.doc} 个文档`);
  if (counts.other > 0) parts.push(`${counts.other} 个其它`);
  return parts.join('、');
}

/**
 * 把毫秒时长格式化为人类可读："2 天 3 小时" / "5 小时" / "12 分钟" / "30 秒"。
 *
 * 业务背景（Task 3 / migration 0009 dwellMs）：项目状态时间线显示"在「洽谈」停留 X"。
 * 上限 2 段（天+小时 / 小时+分），避免 "3 天 5 小时 12 分 9 秒" 噪音。
 *
 * @param ms 毫秒数；null/0/负数返回空串（调用方据此决定是否渲染）
 */
export function formatDwellMs(ms: number | null | undefined): string {
  if (ms == null || ms <= 0) return '';
  const sec = Math.floor(ms / 1000);
  const day = Math.floor(sec / 86400);
  const hour = Math.floor((sec % 86400) / 3600);
  const min = Math.floor((sec % 3600) / 60);

  if (day > 0) {
    return hour > 0 ? `${day} 天 ${hour} 小时` : `${day} 天`;
  }
  if (hour > 0) {
    return min > 0 ? `${hour} 小时 ${min} 分钟` : `${hour} 小时`;
  }
  if (min > 0) return `${min} 分钟`;
  return `${sec} 秒`;
}
