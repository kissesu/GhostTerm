/*
@file rbac.go
@description RBAC 相关 HTTP handler 实现（ogen Handler 接口的 4 个方法）：
             - PermissionsList     GET    /api/permissions
             - RolesList           GET    /api/roles
             - RolesCreate         POST   /api/roles                       (admin only)
             - RolesGetPermissions GET    /api/roles/{id}/permissions

             写入路径 PUT /api/roles/{id}/permissions 已迁至 PermissionsHandler
             （Task 7：复用 PermissionsService 自带 token_version bump + super_admin 校验）。

             admin 校验：roleID == 1 兜底放行；其它角色调 RBACService.HasPermission 检查。
             所有 endpoint 出错统一映射为 ErrorEnvelope。
@author Atlas.oi
@date 2026-04-29
*/

package handlers

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/ghostterm/progress-server/internal/api/middleware"
	"github.com/ghostterm/progress-server/internal/api/oas"
	"github.com/ghostterm/progress-server/internal/services"
)

// RBACHandler 实现 ogen 生成的 oas.Handler 中与 RBAC 相关的方法。
//
// 业务背景：
//   - PermissionsList / RolesList 只要登录即可访问（前端做权限矩阵 UI 渲染时需要）
//   - RolesCreate / RolesUpdatePermissions 仅 admin（roleID == 1）可调
//   - RolesGetPermissions 只要登录即可访问
type RBACHandler struct {
	Svc services.RBACService
	// pool 用于 RolesCreate / RolesUpdatePermissions 的事务写入；
	// 不靠 RBACService 暴露写入接口，避免接口面过大
	pool dbPool
}

// dbPool 是 RBACHandler 仅依赖的最小事务接口。
//
// 业务背景：handler 包不直接 import pgxpool 是为了便于测试 mock；
// 实际生产传入 *pgxpool.Pool 自动满足该接口（已有 Begin 方法）。
type dbPool interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

// NewRBACHandler 构造 RBACHandler。
func NewRBACHandler(svc services.RBACService, pool dbPool) *RBACHandler {
	return &RBACHandler{Svc: svc, pool: pool}
}

// ============================================================
// PermissionsList — GET /api/permissions
// ============================================================

// PermissionsList 返回系统所有权限定义（资源/动作/范围三元组）。
func (h *RBACHandler) PermissionsList(ctx context.Context) (oas.PermissionsListRes, error) {
	if _, ok := middleware.AuthContextFrom(ctx); !ok {
		return unauthorizedErrorEnvelope("未登录"), nil
	}
	perms, err := h.Svc.ListPermissions(ctx)
	if err != nil {
		return nil, fmt.Errorf("rbac handler: list permissions: %w", err)
	}
	return &oas.PermissionListResponse{Data: toOASPermissions(perms)}, nil
}

// ============================================================
// RolesList — GET /api/roles
// ============================================================

// RolesList 列出系统所有角色（系统角色 + 自定义角色）。
func (h *RBACHandler) RolesList(ctx context.Context) (oas.RolesListRes, error) {
	if _, ok := middleware.AuthContextFrom(ctx); !ok {
		return unauthorizedErrorEnvelope("未登录"), nil
	}
	roles, err := h.Svc.ListRoles(ctx)
	if err != nil {
		return nil, fmt.Errorf("rbac handler: list roles: %w", err)
	}
	return &oas.RoleListResponse{Data: toOASRoles(roles)}, nil
}

// ============================================================
// RolesCreate — POST /api/roles (admin only)
// ============================================================

// RolesCreate 创建自定义角色，可选一并绑定 permissionIds。
//
// 业务流程：
//  1. 校验当前 session 是 admin（roleID == 1）；非 admin → 403
//  2. 事务内 INSERT roles + INSERT role_permissions（按 permissionIds）
//  3. 返回 RoleResponse；非超管尝试 → permission_denied
func (h *RBACHandler) RolesCreate(ctx context.Context, req *oas.RoleCreateRequest) (oas.RolesCreateRes, error) {
	ac, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		return rolesCreateUnauthorized("未登录"), nil
	}
	if ac.RoleID != 1 {
		return rolesCreateForbidden("仅超管可创建角色"), nil
	}
	if req == nil || req.Name == "" {
		return rolesCreateValidationError("角色名不能为空"), nil
	}

	tx, err := h.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("rbac handler: begin tx: %w", err)
	}
	// 失败兜底回滚（commit 成功后 rollback 是 no-op）
	defer func() { _ = tx.Rollback(ctx) }()

	// 自定义角色 id 取 max+1（业务上 1/2/3 是系统角色保留）
	var newID int64
	if err := tx.QueryRow(ctx, `
		INSERT INTO roles (id, name, description, is_system)
		VALUES (
			COALESCE((SELECT MAX(id) FROM roles), 0) + 1,
			$1, $2, FALSE
		)
		RETURNING id
	`, req.Name, optStringToPtr(req.Description)).Scan(&newID); err != nil {
		return nil, fmt.Errorf("rbac handler: insert role: %w", err)
	}

	// 绑定权限（UNNEST 一条 INSERT 完成）
	if len(req.PermissionIds) > 0 {
		if _, err := tx.Exec(ctx, `
			INSERT INTO role_permissions (role_id, permission_id)
			SELECT $1, UNNEST($2::BIGINT[])
		`, newID, req.PermissionIds); err != nil {
			return nil, fmt.Errorf("rbac handler: bind permissions: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("rbac handler: commit: %w", err)
	}

	// 重新查一次拿到 created_at（避免手工凑时间戳）
	roles, err := h.Svc.ListRoles(ctx)
	if err != nil {
		return nil, fmt.Errorf("rbac handler: re-list roles: %w", err)
	}
	for _, r := range roles {
		if r.ID == newID {
			return &oas.RoleResponse{Data: toOASRole(r)}, nil
		}
	}
	return nil, errors.New("rbac handler: created role not found in list")
}

// ============================================================
// RolesGetPermissions — GET /api/roles/{id}/permissions
// ============================================================

// RolesGetPermissions 返回某 roleID 已绑定的权限列表。
//
// Task 8 留待：当前 OAS 不声明 403；若需把"仅 permissions:role:manage 可读"加上，
// 需先在 openapi.yaml 加 403 + regen，再添加 perms 校验（参考 RolesUpdatePermissions）。
func (h *RBACHandler) RolesGetPermissions(ctx context.Context, params oas.RolesGetPermissionsParams) (oas.RolesGetPermissionsRes, error) {
	if _, ok := middleware.AuthContextFrom(ctx); !ok {
		return rolesGetPermsUnauthorized("未登录"), nil
	}

	// 先验证角色存在
	roles, err := h.Svc.ListRoles(ctx)
	if err != nil {
		return nil, fmt.Errorf("rbac handler: list roles for get-perms: %w", err)
	}
	roleFound := false
	for _, r := range roles {
		if r.ID == params.ID {
			roleFound = true
			break
		}
	}
	if !roleFound {
		return rolesGetPermsNotFound(fmt.Sprintf("角色 %d 不存在", params.ID)), nil
	}

	// 通过事务直接 query（这里 query 不涉及 RLS 可控表，无需注入 GUC）
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("rbac handler: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	rows, err := tx.Query(ctx, `
		SELECT p.id, p.resource, p.action, p.scope
		FROM role_permissions rp
		JOIN permissions p ON p.id = rp.permission_id
		WHERE rp.role_id = $1
		ORDER BY p.id
	`, params.ID)
	if err != nil {
		return nil, fmt.Errorf("rbac handler: query role permissions: %w", err)
	}
	defer rows.Close()

	var perms []services.Permission
	for rows.Next() {
		var p services.Permission
		if err := rows.Scan(&p.ID, &p.Resource, &p.Action, &p.Scope); err != nil {
			return nil, fmt.Errorf("rbac handler: scan permission: %w", err)
		}
		perms = append(perms, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rbac handler: iterate: %w", err)
	}
	return &oas.PermissionListResponse{Data: toOASPermissions(perms)}, nil
}

// ============================================================
// 辅助：service 层 → oas 层模型转换
// ============================================================

// toOASPermissions 把 []services.Permission 转为 []oas.Permission。
//
// 业务背景：services.Permission.Code() 历史上返回 2 段 "resource:action"（被
// rbac_service_test.go 锁死，不能改）；OAS 契约（Task 7）要求 3 段
// "resource:action:scope"，因此这里在转换时显式拼出 Code 字段，避免破坏
// 既有 service 测试。
func toOASPermissions(perms []services.Permission) []oas.Permission {
	out := make([]oas.Permission, 0, len(perms))
	for _, p := range perms {
		out = append(out, oas.Permission{
			ID:       p.ID,
			Resource: p.Resource,
			Action:   p.Action,
			Scope:    p.Scope,
			Code:     p.Resource + ":" + p.Action + ":" + p.Scope,
		})
	}
	return out
}

// toOASRoles / toOASRole 把 services.Role 转为 oas.Role。
func toOASRoles(roles []services.Role) []oas.Role {
	out := make([]oas.Role, 0, len(roles))
	for _, r := range roles {
		out = append(out, toOASRole(r))
	}
	return out
}

func toOASRole(r services.Role) oas.Role {
	role := oas.Role{
		ID:        r.ID,
		Name:      r.Name,
		IsSystem:  r.IsSystem,
		CreatedAt: r.CreatedAt,
	}
	// description: nullable string
	if r.Description != nil {
		role.Description.SetTo(*r.Description)
	} else {
		role.Description.SetToNull()
	}
	return role
}

// optStringToPtr 把 oas.OptString 转为 *string（NULL 落 DB）。
func optStringToPtr(o oas.OptString) *string {
	if !o.Set {
		return nil
	}
	v := o.Value
	return &v
}

// ============================================================
// 错误响应构造
// ============================================================

func rolesCreateUnauthorized(msg string) *oas.RolesCreateUnauthorized {
	e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeUnauthorized, msg)
	res := oas.RolesCreateUnauthorized(e)
	return &res
}

func rolesCreateForbidden(msg string) *oas.RolesCreateForbidden {
	e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodePermissionDenied, msg)
	res := oas.RolesCreateForbidden(e)
	return &res
}

func rolesCreateValidationError(msg string) *oas.RolesCreateUnprocessableEntity {
	e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeValidationFailed, msg)
	res := oas.RolesCreateUnprocessableEntity(e)
	return &res
}

func rolesGetPermsUnauthorized(msg string) *oas.RolesGetPermissionsUnauthorized {
	e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeUnauthorized, msg)
	res := oas.RolesGetPermissionsUnauthorized(e)
	return &res
}

func rolesGetPermsNotFound(msg string) *oas.RolesGetPermissionsNotFound {
	e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeNotFound, msg)
	res := oas.RolesGetPermissionsNotFound(e)
	return &res
}

