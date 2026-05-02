/**
 * @file permissionLabels.ts
 * @description Atlas 权限管理 UI 的中文标签字典。
 *
 *              业务背景：用户明确要求"角色权限和权限管理的字段与值都不要使用英文"
 *              （2026-05-02）。后端 permissions 表三元组 (resource, action, scope) 仍用
 *              英文 code 作为 API 契约，前端展示层在这里集中翻译。
 *
 *              字典覆盖范围：
 *                - RESOURCE_CN：模块/资源名（如 progress / users / nav）
 *                - ACTION_CN：动作名（如 list / create / view / trigger）
 *                - SCOPE_CN：作用域名（如 work / progress / atlas / all）
 *
 *              缺失 fallback：找不到映射时回落英文 code，便于发现未覆盖的新增 perm
 *              （UI 上还是会暴露英文 → 立刻知道要补字典）。
 *
 * @author Atlas.oi
 * @date 2026-05-02
 */

export const RESOURCE_CN: Record<string, string> = {
  '*': '全部资源',
  project: '项目',
  feedback: '反馈',
  payment: '收款',
  thesis: '论文',
  file: '文件',
  event: '事件',
  quote: '报价',
  user: '用户',
  role: '角色',
  permissions: '权限管理',
  nav: '导航 Tab',
  progress: '进度模块',
  users: '用户管理',
};

export const ACTION_CN: Record<string, string> = {
  '*': '全部',
  // 通用 CRUD
  read: '查看',
  list: '查看',
  view: '查看',
  create: '创建',
  update: '编辑',
  edit: '编辑',
  delete: '删除',
  // 资源动作
  upload: '上传',
  manage: '管理',
  access: '访问',
  trigger: '触发',
  change: '变更',
  // 进度模块（resource=progress 时 action 是子资源）
  project: '项目',
  feedback: '反馈',
  payment: '收款',
  thesis: '论文',
  file: '文件',
  event: '事件',
  quote: '报价',
  // 权限管理
  role: '角色',
  user_override: '用户细分',
};

export const SCOPE_CN: Record<string, string> = {
  '*': '全部',
  all: '全部',
  // CRUD scope（多用于 progress:project:list 等三段码）
  list: '查看',
  create: '创建',
  edit: '编辑',
  delete: '删除',
  upload: '上传',
  trigger: '触发',
  change: '变更',
  manage: '管理',
  // nav 三个 tab 名
  work: '工作区',
  progress: '进度',
  atlas: '控制台',
};

/**
 * 把 resource code 翻译成中文标签；找不到时回落英文（暴露字典缺口）。
 */
export function formatResourceLabel(resource: string): string {
  return RESOURCE_CN[resource] ?? resource;
}

/**
 * 把 (resource, action) 翻译成中文动作标签。
 *
 * 业务特例：
 *   - event:E1 / E2... 业务事件编号保留原文（无中文等价）
 *
 * @param resource 资源 code
 * @param action 动作 code
 * @returns 中文动作名；找不到时回落英文 code
 */
export function formatActionLabel(resource: string, action: string): string {
  if (resource === 'event' && /^E\d+$/.test(action)) {
    return `事件 ${action}`;
  }
  return ACTION_CN[action] ?? action;
}

/**
 * 把 scope 翻译成中文；'all' / '*' 回落"全部"。
 */
export function formatScopeLabel(scope: string): string {
  return SCOPE_CN[scope] ?? scope;
}

/**
 * 完整中文权限文本：「资源·动作·作用域」。
 *
 * 用于权限矩阵每行的 label，替代之前 "project (list) progress:project:list" 的英文混排。
 *
 * 例：
 *   - (progress, project, list) → "进度模块 · 项目 · 查看"
 *   - (nav, view, work)         → "导航 Tab · 查看 · 工作区"
 *   - (users, list, all)        → "用户管理 · 查看 · 全部"
 *
 * scope='all' 时省略最后一段（`users:list:all` → "用户管理 · 查看"）减少冗余。
 */
export function formatPermissionLabel(resource: string, action: string, scope: string): string {
  const r = formatResourceLabel(resource);
  const a = formatActionLabel(resource, action);
  if (scope === 'all' || scope === '*') {
    return `${r} · ${a}`;
  }
  return `${r} · ${a} · ${formatScopeLabel(scope)}`;
}

/**
 * 短中文权限文本：在「按 resource 分组的两层 thead 矩阵」里使用。
 * 第一行 thead 已显示 resource（如"进度模块"），第二行只需显示动作+作用域，
 * 避免每列重复"进度模块·xxx·yyy"造成视觉冗余（用户需求 2026-05-02）。
 *
 * 业务规则：
 *   - nav 资源（action 固定为 view）：直接返 SCOPE_CN[scope]，如 "工作区/进度/控制台"
 *   - 其他资源 + scope='all' / '*'：只返 action 中文，如 users:list:all → "查看"
 *   - 其他：返 action + scope 拼接，如 progress:project:list → "项目查看"
 *
 * 例：
 *   - (nav, view, work)         → "工作区"
 *   - (nav, view, atlas)        → "控制台"
 *   - (progress, project, list) → "项目查看"
 *   - (progress, feedback, create) → "反馈创建"
 *   - (users, list, all)        → "查看"
 *   - (permissions, role, manage) → "角色管理"
 */
export function formatShortPermLabel(resource: string, action: string, scope: string): string {
  if (resource === 'nav') {
    return formatScopeLabel(scope);
  }
  const a = formatActionLabel(resource, action);
  if (scope === 'all' || scope === '*') {
    return a;
  }
  return `${a}${formatScopeLabel(scope)}`;
}
