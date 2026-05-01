/**
 * @file projects.ts
 * @description 进度模块项目相关 API 客户端 + zod schemas。
 *
 *              业务背景（v2 §W1 / §W8）：
 *              - 所有响应必须经 zod 校验，schema 漂移即抛 ProgressApiError(code='schema_drift')
 *              - apiFetch 已自动剥 DataEnvelope 壳，返回 data 部分
 *
 *              覆盖端点：
 *                GET    /api/projects                    list (含可选 status filter)
 *                POST   /api/projects                    create
 *                GET    /api/projects/{id}               get
 *                PATCH  /api/projects/{id}               update
 *                POST   /api/projects/{id}/events        trigger event（触发状态机）
 *                GET    /api/projects/{id}/status-changes list status changes
 *
 *              本文件不与 store 直接耦合：纯函数 + 类型；store 调用本文件的 helpers。
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { z } from 'zod';

import { apiFetch } from './client';

// ============================================
// 枚举
// ============================================

/** 与后端 OAS components.schemas.ProjectStatus 严格对齐（spec §6.1 9 状态） */
export const ProjectStatusEnum = z.enum([
  'dealing',
  'quoting',
  'developing',
  'confirming',
  'delivered',
  'paid',
  'archived',
  'after_sales',
  'cancelled',
]);
export type ProjectStatus = z.infer<typeof ProjectStatusEnum>;

export const ProjectPriorityEnum = z.enum(['urgent', 'normal']);
export type ProjectPriority = z.infer<typeof ProjectPriorityEnum>;

export const ThesisLevelEnum = z.enum(['bachelor', 'master', 'doctor']);
export type ThesisLevel = z.infer<typeof ThesisLevelEnum>;

/**
 * spec §6.2 16 事件
 *
 * 前端触发分类（与 src/features/progress/api/__tests__/event-coverage.test.ts 同步）：
 * - 前端 UI 可触发（15 个）：E1-E13 + E_AS1 + E_AS3
 *   → 通过 NbaPanel / EventTriggerDialog 触发，配置见 src/features/progress/config/nbaConfig.ts
 * - 后端独占（1 个）：E0 创建项目
 *   → 由 ProjectCreateDialog 调 POST /api/projects 创建项目时后端自动 fire，前端不暴露 NBA 按钮
 *
 * 任何新增 event code 必须更新 event-coverage.test.ts 的两个清单之一。
 */
export const EventCodeEnum = z.enum([
  'E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7',
  'E8', 'E9', 'E10', 'E11', 'E12', 'E13',
  'E_AS1', 'E_AS3',
]);
export type EventCode = z.infer<typeof EventCodeEnum>;

// ============================================
// Money: 后端用 string ("123.45") 表达，前端保持原样不做 number 转换
// （spec §3.5 + W4：避免 JS 浮点损失精度）
// ============================================
export const MoneySchema = z.string().regex(/^-?\d+(\.\d{1,2})?$/, '金额格式应为 1-2 位小数');
export type Money = z.infer<typeof MoneySchema>;

// ============================================
// Project schema
// ============================================

export const ProjectSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  customerLabel: z.string(),
  description: z.string(),
  priority: ProjectPriorityEnum,
  thesisLevel: ThesisLevelEnum.nullable().optional(),
  subject: z.string().nullable().optional(),
  status: ProjectStatusEnum,
  holderRoleId: z.number().int().nullable().optional(),
  holderUserId: z.number().int().nullable().optional(),
  deadline: z.string(),
  dealingAt: z.string(),
  quotingAt: z.string().nullable().optional(),
  devStartedAt: z.string().nullable().optional(),
  confirmingAt: z.string().nullable().optional(),
  deliveredAt: z.string().nullable().optional(),
  paidAt: z.string().nullable().optional(),
  archivedAt: z.string().nullable().optional(),
  afterSalesAt: z.string().nullable().optional(),
  cancelledAt: z.string().nullable().optional(),
  originalQuote: MoneySchema,
  currentQuote: MoneySchema,
  afterSalesTotal: MoneySchema,
  totalReceived: MoneySchema,
  openingDocId: z.number().int().nullable().optional(),
  assignmentDocId: z.number().int().nullable().optional(),
  formatSpecDocId: z.number().int().nullable().optional(),
  createdBy: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const ProjectListSchema = z.array(ProjectSchema);

// ============================================
// StatusChangeLog schema
// ============================================

export const StatusChangeLogSchema = z.object({
  id: z.number().int(),
  projectId: z.number().int(),
  eventCode: z.string(),
  eventName: z.string(),
  fromStatus: ProjectStatusEnum.nullable().optional(),
  toStatus: ProjectStatusEnum,
  fromHolderId: z.number().int().nullable().optional(),
  toHolderId: z.number().int().nullable().optional(),
  remark: z.string(),
  triggeredBy: z.number().int(),
  triggeredAt: z.string(),
});
export type StatusChangeLog = z.infer<typeof StatusChangeLogSchema>;

export const StatusChangeLogListSchema = z.array(StatusChangeLogSchema);

// ============================================
// 入参类型（与 OpenAPI 对齐）
// ============================================

export interface CreateProjectInput {
  name: string;
  customerLabel: string;
  description: string;
  priority?: ProjectPriority;
  thesisLevel?: ThesisLevel;
  subject?: string;
  deadline: string; // ISO 8601
  originalQuote?: Money;
}

export interface UpdateProjectInput {
  name?: string;
  customerLabel?: string;
  description?: string;
  priority?: ProjectPriority;
  thesisLevel?: ThesisLevel;
  subject?: string | null; // null 表示"清空"
  deadline?: string;
}

export interface TriggerEventInput {
  event: EventCode;
  remark: string;
  newHolderUserId?: number | null;
}

// ============================================
// API helpers
// ============================================

/**
 * GET /api/projects → Project[]
 *
 * @param status 可选 status filter；undefined 表示不过滤
 */
export async function listProjects(status?: ProjectStatus): Promise<Project[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiFetch(`/api/projects${qs}`, { method: 'GET' }, ProjectListSchema);
}

/** POST /api/projects → Project */
export async function createProject(input: CreateProjectInput): Promise<Project> {
  return apiFetch(
    '/api/projects',
    { method: 'POST', body: JSON.stringify(input) },
    ProjectSchema,
  );
}

/** GET /api/projects/{id} → Project */
export async function getProject(id: number): Promise<Project> {
  return apiFetch(`/api/projects/${id}`, { method: 'GET' }, ProjectSchema);
}

/** PATCH /api/projects/{id} → Project */
export async function updateProject(id: number, input: UpdateProjectInput): Promise<Project> {
  return apiFetch(
    `/api/projects/${id}`,
    { method: 'PATCH', body: JSON.stringify(input) },
    ProjectSchema,
  );
}

/** POST /api/projects/{id}/events → Project（推进状态机后的最新状态） */
export async function triggerProjectEvent(id: number, input: TriggerEventInput): Promise<Project> {
  return apiFetch(
    `/api/projects/${id}/events`,
    { method: 'POST', body: JSON.stringify(input) },
    ProjectSchema,
  );
}

/** GET /api/projects/{id}/status-changes → StatusChangeLog[] */
export async function listProjectStatusChanges(id: number): Promise<StatusChangeLog[]> {
  return apiFetch(
    `/api/projects/${id}/status-changes`,
    { method: 'GET' },
    StatusChangeLogListSchema,
  );
}
