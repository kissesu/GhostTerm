/*
@file permissions.go
@description 权限管理 HTTP handler，覆盖 6 个 OAS 端点：

  GET  /api/permissions                              全量 permission 字典（前端权限矩阵 UI）
  GET  /api/me/effective-permissions                 当前用户有效权限码（含 super_admin 哨兵）
  GET  /api/roles/{id}/permissions                   单角色 grant 列表
  PUT  /api/roles/{id}/permissions                   全量替换角色权限（写）
  GET  /api/users/{id}/permission-overrides          单用户 grant/deny 覆写列表
  PUT  /api/users/{id}/permission-overrides          全量替换用户覆写（写）

Task 7 引入：
  - 写路径全部走 PermissionsService（同事务 bump token_version 让权限变更"立即生效"）
  - super_admin 拦截在 SuperAdminInvariants 中间件 + service 双层拦截，本 handler 仅
    把 service sentinel error 翻译为 OAS 响应类型
  - GET /api/me/effective-permissions 直接调 EffectivePermissionsService.Compute；不缓存
    （缓存职责归 Task 8 RBAC middleware）
  - 3 段权限 code 拼装：service.Permission.Code() 历史返回 2 段且被 rbac_service_test
    锁死，本 handler 在 toOAS 时显式拼 resource:action:scope（与 rbac.go::toOASPermissions
    保持一致）

错误映射（service sentinel → HTTP）：
  - ErrSuperAdminImmutable           → 422 super_admin_immutable
  - ErrInvalidEffect                 → 422 invalid_effect
  - ErrUserNotFound / ErrRoleNotFound → 404 not_found
  - 其它 DB / 内部错误               → bubble up 让 errorEnvelopeHandler 兜 500

@author Atlas.oi
@date 2026-05-02
*/

package handlers

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ghostterm/progress-server/internal/api/middleware"
	"github.com/ghostterm/progress-server/internal/api/oas"
	"github.com/ghostterm/progress-server/internal/services"
)

// PermissionsHandler 装配 catalog 查询 + role/user 写入 + effective 计算所需的依赖。
//
// 设计取舍：
//   - perms / eff 是 Task 5/6 已完成的服务，本 handler 仅做"认证+错误映射+OAS 类型转换"
//   - pool 用于 catalog 查询（GET /api/permissions）。catalog 是只读字典，没必要为它
//     新建一个 service；handler 内 inline 一条 SELECT 即可，符合 first-principles 的
//     "一处使用不抽象"。
//   - 不持有 RBACService：role 默认 grants 由 PermissionsService.ListRolePermissions 提供，
//     与 rbac.go 的 ListPermissions 是两类查询（catalog vs. role-bound），职责不重叠。
type PermissionsHandler struct {
	pool  *pgxpool.Pool
	perms services.PermissionsService
	eff   services.EffectivePermissionsService
}

// NewPermissionsHandler 构造 PermissionsHandler。
func NewPermissionsHandler(
	pool *pgxpool.Pool,
	perms services.PermissionsService,
	eff services.EffectivePermissionsService,
) *PermissionsHandler {
	return &PermissionsHandler{pool: pool, perms: perms, eff: eff}
}

// ============================================================
// PermissionsList — GET /api/permissions
// ============================================================
//
// 业务背景：前端权限矩阵 UI（Task 10）需要拿到全量 permissions 列表，
// 否则用户无法选中"想要授予的权限"。仅要求登录态，不做 super_admin 限制
// （配置面板对 super_admin 仍只读展示，不影响普通查询）。

// PermissionsList 返回 permissions 表的全量字典。
//
// 注意：这里 *不* 复用 RBACService.ListPermissions —— 它走 RBAC service 的内部缓存
// 链路（与 role 绑定相关）。Task 7 catalog 查询是无状态字典查询，直接 pool 查更直白。
func (h *PermissionsHandler) PermissionsList(ctx context.Context) (oas.PermissionsListRes, error) {
	if _, ok := middleware.AuthContextFrom(ctx); !ok {
		return unauthorizedErrorEnvelope("未登录"), nil
	}

	rows, err := h.pool.Query(ctx, `
		SELECT id, resource, action, scope
		FROM permissions
		ORDER BY id
	`)
	if err != nil {
		return nil, fmt.Errorf("permissions handler: list: %w", err)
	}
	defer rows.Close()

	out := make([]oas.Permission, 0)
	for rows.Next() {
		var p services.Permission
		if err := rows.Scan(&p.ID, &p.Resource, &p.Action, &p.Scope); err != nil {
			return nil, fmt.Errorf("permissions handler: scan: %w", err)
		}
		out = append(out, oas.Permission{
			ID:       p.ID,
			Resource: p.Resource,
			Action:   p.Action,
			Scope:    p.Scope,
			Code:     p.Resource + ":" + p.Action + ":" + p.Scope,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("permissions handler: iterate: %w", err)
	}
	return &oas.PermissionListResponse{Data: out}, nil
}

// ============================================================
// MeGetEffectivePermissions — GET /api/me/effective-permissions
// ============================================================
//
// 业务流程：
//   1. 取 AuthContext 的 UserID
//   2. 调 EffectivePermissionsService.Compute → []string
//   3. 当结果是 ["*:*"] 哨兵时，superAdmin=true；否则 false
//
// 业务背景：前端 PermissionGate / AppLayout tab 渲染需要这一份"已合并的权限码"，
// 避免前端自己重算 role∪grant−deny。该接口对 token 失效极敏感（权限变更后旧 token
// 必 401，前端 silent refresh 后再调本接口取最新集合），不能加缓存。

func (h *PermissionsHandler) MeGetEffectivePermissions(ctx context.Context) (oas.MeGetEffectivePermissionsRes, error) {
	ac, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		return unauthorizedErrorEnvelope("未登录"), nil
	}

	codes, err := h.eff.Compute(ctx, ac.UserID)
	if err != nil {
		// userID 不存在按 401 处理：能拿到 AuthContext 说明 token 验签通过；
		// 此时用户在 DB 不存在意味着账号被删；前端应当重登
		if errors.Is(err, services.ErrUserNotFound) {
			return unauthorizedErrorEnvelope("账号已不存在，请重新登录"), nil
		}
		return nil, fmt.Errorf("permissions handler: compute effective: %w", err)
	}

	// 哨兵识别：EffectivePermissionsService 对 super_admin 返回固定 ["*:*"]
	superAdmin := len(codes) == 1 && codes[0] == "*:*"

	return &oas.EffectivePermissionsResponse{
		Permissions: codes,
		SuperAdmin:  superAdmin,
	}, nil
}

// ============================================================
// RolesUpdatePermissions — PUT /api/roles/{id}/permissions
// ============================================================
//
// 业务流程：
//   1. AuthContext 校验
//   2. 调 PermissionsService.UpdateRolePermissions（含 super_admin 拦截、token_version bump）
//   3. sentinel error 翻译为对应 OAS Res
//
// 业务背景：写路径必经 SuperAdminInvariants 中间件，理论上 roleID==1 不会到达 service；
// service 仍兜底返 ErrSuperAdminImmutable 防中间件未挂或重构遗失，handler 翻译成 422。

func (h *PermissionsHandler) RolesUpdatePermissions(
	ctx context.Context,
	req *oas.RolePermissionUpdateRequest,
	params oas.RolesUpdatePermissionsParams,
) (oas.RolesUpdatePermissionsRes, error) {
	ac, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		return rolesUpdatePermsUnauthorized("未登录"), nil
	}
	// 仅 super_admin 可写；其它角色一律拒
	if ac.RoleID != services.SuperAdminRoleID {
		return rolesUpdatePermsForbidden("仅超管可修改角色权限"), nil
	}

	permIDs := []int64{}
	if req != nil {
		permIDs = req.PermissionIds
	}

	err := h.perms.UpdateRolePermissions(ctx, params.ID, permIDs, ac.UserID)
	switch {
	case err == nil:
		return &oas.RolesUpdatePermissionsNoContent{}, nil
	case errors.Is(err, services.ErrSuperAdminImmutable):
		return rolesUpdatePermsSuperAdminImmutable("禁止修改超管角色权限绑定"), nil
	case errors.Is(err, services.ErrRoleNotFound):
		return rolesUpdatePermsNotFound(fmt.Sprintf("角色 %d 不存在", params.ID)), nil
	default:
		return nil, fmt.Errorf("permissions handler: update role: %w", err)
	}
}

// ============================================================
// UsersGetPermissionOverrides — GET /api/users/{id}/permission-overrides
// ============================================================
//
// 业务背景：仅 super_admin 可调。Atlas UserPermissionOverridePanel（Task 11）
// 在选中目标用户时拉本接口，渲染 "当前覆写"。

func (h *PermissionsHandler) UsersGetPermissionOverrides(
	ctx context.Context,
	params oas.UsersGetPermissionOverridesParams,
) (oas.UsersGetPermissionOverridesRes, error) {
	ac, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		return usersGetOverridesUnauthorized("未登录"), nil
	}
	if ac.RoleID != services.SuperAdminRoleID {
		return usersGetOverridesForbidden("仅超管可查询用户权限覆写"), nil
	}

	overrides, err := h.perms.ListUserOverrides(ctx, params.ID)
	if err != nil {
		if errors.Is(err, services.ErrUserNotFound) {
			return usersGetOverridesNotFound(fmt.Sprintf("用户 %d 不存在", params.ID)), nil
		}
		return nil, fmt.Errorf("permissions handler: list user overrides: %w", err)
	}

	out := make([]oas.UserPermissionOverride, 0, len(overrides))
	for _, o := range overrides {
		out = append(out, oas.UserPermissionOverride{
			PermissionId: o.PermissionID,
			Effect:       oas.UserPermissionOverrideEffect(o.Effect),
		})
	}
	return &oas.UserPermissionOverridesResponse{
		UserId:    params.ID,
		Overrides: out,
	}, nil
}

// ============================================================
// UsersUpdatePermissionOverrides — PUT /api/users/{id}/permission-overrides
// ============================================================
//
// 业务流程：
//   1. AuthContext + super_admin 校验
//   2. 翻译 OAS 入参 → service.UserOverride（effect 字符串)
//   3. 调 PermissionsService.UpdateUserOverrides
//   4. sentinel error 翻译为 OAS Res

func (h *PermissionsHandler) UsersUpdatePermissionOverrides(
	ctx context.Context,
	req *oas.UpdateUserPermissionOverridesRequest,
	params oas.UsersUpdatePermissionOverridesParams,
) (oas.UsersUpdatePermissionOverridesRes, error) {
	ac, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		return usersUpdateOverridesUnauthorized("未登录"), nil
	}
	if ac.RoleID != services.SuperAdminRoleID {
		return usersUpdateOverridesForbidden("仅超管可修改用户权限覆写"), nil
	}

	overrides := make([]services.UserOverride, 0)
	if req != nil {
		for _, o := range req.Overrides {
			overrides = append(overrides, services.UserOverride{
				PermissionID: o.PermissionId,
				Effect:       string(o.Effect),
			})
		}
	}

	err := h.perms.UpdateUserOverrides(ctx, params.ID, overrides, ac.UserID)
	switch {
	case err == nil:
		return &oas.UsersUpdatePermissionOverridesNoContent{}, nil
	case errors.Is(err, services.ErrSuperAdminImmutable):
		return usersUpdateOverridesSuperAdminImmutable("禁止覆写超管用户的权限"), nil
	case errors.Is(err, services.ErrInvalidEffect):
		return usersUpdateOverridesInvalidEffect(err.Error()), nil
	case errors.Is(err, services.ErrUserNotFound):
		return usersUpdateOverridesNotFound(fmt.Sprintf("用户 %d 不存在", params.ID)), nil
	default:
		return nil, fmt.Errorf("permissions handler: update user overrides: %w", err)
	}
}

// ============================================================
// 错误响应构造（每个 op 因 ogen 强类型生成独立的 *Unauthorized/*NotFound 等）
// ============================================================

func rolesUpdatePermsUnauthorized(msg string) *oas.RolesUpdatePermissionsUnauthorized {
	e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeUnauthorized, msg)
	res := oas.RolesUpdatePermissionsUnauthorized(e)
	return &res
}

func rolesUpdatePermsForbidden(msg string) *oas.RolesUpdatePermissionsForbidden {
	e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodePermissionDenied, msg)
	res := oas.RolesUpdatePermissionsForbidden(e)
	return &res
}

func rolesUpdatePermsNotFound(msg string) *oas.RolesUpdatePermissionsNotFound {
	e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeNotFound, msg)
	res := oas.RolesUpdatePermissionsNotFound(e)
	return &res
}

// rolesUpdatePermsSuperAdminImmutable 422 super_admin_immutable 的 service 兜底响应。
// 理论上 SuperAdminInvariants middleware 已先拦截，service 走到这里说明中间件未挂；
// 仍然映射为 422 + super_admin_immutable，给前端一致的错误码。
func rolesUpdatePermsSuperAdminImmutable(msg string) *oas.RolesUpdatePermissionsUnprocessableEntity {
	e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeSuperAdminImmutable, msg)
	res := oas.RolesUpdatePermissionsUnprocessableEntity(e)
	return &res
}

func usersGetOverridesUnauthorized(msg string) *oas.UsersGetPermissionOverridesUnauthorized {
	e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeUnauthorized, msg)
	res := oas.UsersGetPermissionOverridesUnauthorized(e)
	return &res
}

func usersGetOverridesForbidden(msg string) *oas.UsersGetPermissionOverridesForbidden {
	e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodePermissionDenied, msg)
	res := oas.UsersGetPermissionOverridesForbidden(e)
	return &res
}

func usersGetOverridesNotFound(msg string) *oas.UsersGetPermissionOverridesNotFound {
	e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeNotFound, msg)
	res := oas.UsersGetPermissionOverridesNotFound(e)
	return &res
}

func usersUpdateOverridesUnauthorized(msg string) *oas.UsersUpdatePermissionOverridesUnauthorized {
	e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeUnauthorized, msg)
	res := oas.UsersUpdatePermissionOverridesUnauthorized(e)
	return &res
}

func usersUpdateOverridesForbidden(msg string) *oas.UsersUpdatePermissionOverridesForbidden {
	e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodePermissionDenied, msg)
	res := oas.UsersUpdatePermissionOverridesForbidden(e)
	return &res
}

func usersUpdateOverridesNotFound(msg string) *oas.UsersUpdatePermissionOverridesNotFound {
	e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeNotFound, msg)
	res := oas.UsersUpdatePermissionOverridesNotFound(e)
	return &res
}

func usersUpdateOverridesSuperAdminImmutable(msg string) *oas.UsersUpdatePermissionOverridesUnprocessableEntity {
	e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeSuperAdminImmutable, msg)
	res := oas.UsersUpdatePermissionOverridesUnprocessableEntity(e)
	return &res
}

func usersUpdateOverridesInvalidEffect(msg string) *oas.UsersUpdatePermissionOverridesUnprocessableEntity {
	e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeInvalidEffect, msg)
	res := oas.UsersUpdatePermissionOverridesUnprocessableEntity(e)
	return &res
}
