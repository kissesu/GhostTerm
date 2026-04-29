/**
 * @file schemas.ts
 * @description 进度模块 API 响应的 zod 运行时校验 schema。
 *
 *              v2 §W1 要求所有 endpoint 响应在 client 处用 zod 二次校验，
 *              发现 schema drift 立即抛 ProgressApiError({ code: 'schema_drift' })，
 *              拒绝静默接受类型错位的数据。
 *
 *              Phase 0d 只构造 ProgressShell 入口需要的两个 schema：
 *                - LoginResponse  对应 components.schemas.AuthLoginResponse
 *                - User           对应 components.schemas.User（用于 /api/auth/me）
 *
 *              其余 schema（Project / Customer / Feedback / Quote / Payment / File 等）
 *              由各 Worker 在自己的 phase 内补全（见底部 TODO 列表）。
 *
 *              所有 schema 命名与 openapi.yaml components.schemas.* 一致，迁移到
 *              openapi-zod-client 自动生成时可平滑替换。
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { z } from 'zod';

// ============================================
// 认证相关
// ============================================

/**
 * 当前登录用户。
 * 对应 openapi.yaml components.schemas.User
 */
export const UserSchema = z.object({
  id: z.number().int(),
  email: z.string().email(),
  displayName: z.string(),
  roleId: z.number().int(),
  isActive: z.boolean(),
  createdAt: z.string(),
});

export type UserPayload = z.infer<typeof UserSchema>;

/**
 * 登录响应：access + refresh + 用户信息。
 * 对应 openapi.yaml components.schemas.AuthLoginResponse
 */
export const LoginResponseSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  user: UserSchema,
});

export type LoginResponsePayload = z.infer<typeof LoginResponseSchema>;

/**
 * 刷新响应：仅返回新 access token。
 * 对应 openapi.yaml components.schemas.AuthRefreshResponse
 */
export const RefreshResponseSchema = z.object({
  accessToken: z.string().min(1),
});

export type RefreshResponsePayload = z.infer<typeof RefreshResponseSchema>;

// ============================================
// 待补 schema（按 phase 分配）
// ============================================
// TODO(Phase 2 - 用户与 JWT 认证):
//   - WSTicket    （短期 WS 票据）
// TODO(Phase 4 - Worker A customer):
//   - Customer / CustomerCreateRequest / CustomerUpdateRequest
// TODO(Phase 5 - Worker B project):
//   - Project / ProjectCreateRequest / ProjectStatus / ProjectPriority
//   - ThesisLevel / ThesisExtension / RiskItem
// TODO(Phase 6 - Worker C file):
//   - FileObject / FileUploadInitRequest / FileUploadInitResponse
// TODO(Phase 7 - Worker D feedback):
//   - Feedback / FeedbackCreateRequest / FeedbackResolveRequest
// TODO(Phase 8 - Worker E quote):
//   - QuoteChange / QuoteChangeCreateRequest
// TODO(Phase 9 - Worker F payment):
//   - Payment / PaymentCreateRequest / EarningsSummary
// TODO(Phase 12 - 通知):
//   - Notification / WSEvent
// TODO(管理员):
//   - Role / Permission / RoleCreateRequest / RolePermissionUpdateRequest
