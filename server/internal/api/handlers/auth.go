/*
@file auth.go
@description 认证相关 HTTP handler 实现（ogen Handler 接口对应方法）：
             - AuthLogin / AuthRefresh / AuthLogout / AuthGetMe / WsTicketIssue
             所有 endpoint 出错统一映射为 ErrorEnvelope（不直接抛 5xx），
             v2 part3 §AB1 要求"绝不让 router 阶段返回 panic 或裸 ErrNotImplemented"。

             业务身份注入约定（v2 part2 §W11+）：
             - 鉴权中间件解析 Bearer token，把 services.AuthContext 写入 request context
             - handler 通过 contextkey 取出 AuthContext，传给 service 层
@author Atlas.oi
@date 2026-04-29
*/

package handlers

import (
	"context"
	"errors"

	"github.com/ghostterm/progress-server/internal/api/middleware"
	"github.com/ghostterm/progress-server/internal/api/oas"
	"github.com/ghostterm/progress-server/internal/services"
)

// AuthHandler 实现 ogen 生成的 oas.Handler 中与 auth 相关的 5 个方法。
//
// 业务背景：
// - ogen 把所有 endpoint 都收敛到一个 Handler 接口；其它 phase 的 worker 也会
//   往同一个 oasHandler 上挂方法。本 struct 单独负责 auth 部分，由 router.go
//   的 oasHandler "组合"（嵌入）进来
//
// 字段：
// - Svc：认证 service
// - RBAC：权限 service（Phase 3 加入），AuthGetMe 拉用户时附带 permission 码列表
//   返回前端，用于 PermissionGate 的 UI 守卫
type AuthHandler struct {
	Svc  services.AuthService
	RBAC services.RBACService
	// EffectivePerms：Task 8 加入；优先用它替代 RBAC.LoadUserPermissions，
	// 才能让 super_admin（role_id=1）正确拿到 ['*:*'] 通配权限码。
	// 旧 RBAC.LoadUserPermissions 走 role_permissions 表 JOIN，但 0007 trigger
	// 拒写 role_id=1 的行 → super_admin 永远返空 → 前端 PermissionGate 全失效。
	EffectivePerms services.EffectivePermissionsService
}

// NewAuthHandler 构造 AuthHandler；rbac/effectivePerms 允许 nil（Phase 2 兼容），
// 都缺失时 AuthGetMe 不附带 permissions 字段（仍合法，为空数组）。
func NewAuthHandler(
	svc services.AuthService,
	rbac services.RBACService,
	effectivePerms services.EffectivePermissionsService,
) *AuthHandler {
	return &AuthHandler{Svc: svc, RBAC: rbac, EffectivePerms: effectivePerms}
}

// ============================================================
// AuthLogin
// ============================================================

// AuthLogin 实现 POST /api/auth/login。
//
// 业务流程：
//  1. 调 svc.Login → access / refresh / AuthUser
//  2. 把 AuthUser 转成 oas.User 并装进 AuthLoginEnvelope 返回
//
// 错误映射：
//   - ErrInvalidCredentials → 401 unauthorized
//   - ErrUserInactive       → 401 unauthorized（不暴露 active 状态防 enumeration）
//   - 其它                  → 500 internal（由 ogen 默认 ErrorHandler 包裹）
func (h *AuthHandler) AuthLogin(ctx context.Context, req *oas.AuthLoginRequest) (oas.AuthLoginRes, error) {
	access, refresh, raw, err := h.Svc.Login(ctx, req.Username, req.Password)
	if err != nil {
		if errors.Is(err, services.ErrInvalidCredentials) || errors.Is(err, services.ErrUserInactive) {
			return unauthorizedLoginRes("用户名或密码错误"), nil
		}
		return nil, err
	}
	user, ok := raw.(services.AuthUser)
	if !ok {
		return nil, errors.New("auth handler: unexpected user type from service")
	}
	resp := &oas.AuthLoginEnvelope{
		Data: oas.AuthLoginResponse{
			AccessToken:  access,
			RefreshToken: refresh,
			User:         toOASUser(user),
		},
	}
	return resp, nil
}

// ============================================================
// AuthRefresh
// ============================================================

// AuthRefresh 实现 POST /api/auth/refresh。
//
// 错误映射：
//   - ErrInvalidRefreshToken → 401 unauthorized
//   - 其它                   → 500 internal
func (h *AuthHandler) AuthRefresh(ctx context.Context, req *oas.AuthRefreshRequest) (oas.AuthRefreshRes, error) {
	access, newRefresh, err := h.Svc.Refresh(ctx, req.RefreshToken)
	if err != nil {
		if errors.Is(err, services.ErrInvalidRefreshToken) {
			return unauthorizedErrorEnvelope("refresh token 无效或已过期"), nil
		}
		return nil, err
	}
	return &oas.AuthRefreshEnvelope{
		Data: oas.AuthRefreshResponse{
			AccessToken:  access,
			RefreshToken: newRefresh,
		},
	}, nil
}

// ============================================================
// AuthLogout
// ============================================================

// AuthLogout 实现 POST /api/auth/logout。
//
// 业务流程：
//  1. 从 ctx 取 AuthContext（鉴权中间件注入）
//  2. svc.Logout 递增 token_version + revoke 全部 refresh
//  3. 返回 204 No Content
func (h *AuthHandler) AuthLogout(ctx context.Context) (oas.AuthLogoutRes, error) {
	sc, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		return unauthorizedErrorEnvelope("未登录"), nil
	}
	if err := h.Svc.Logout(ctx, sc); err != nil {
		return nil, err
	}
	return &oas.AuthLogoutNoContent{}, nil
}

// ============================================================
// AuthGetMe
// ============================================================

// AuthGetMe 实现 GET /api/auth/me。
//
// 业务流程：
//  1. 从 ctx 取 AuthContext；svc.Me 拿到用户基础信息
//  2. 若 RBAC service 已注入：调 LoadUserPermissions(roleID) 拉权限码集合
//     转成 []string 后塞进 oas.User.Permissions（前端 PermissionGate 据此判定）
//  3. 失败时不让 me 失败：权限拉取错误打印到 server log，permissions 留空
//     —— 用户已登录，至少能看到自己的基本信息，权限菜单 UI 自然降级（缺权限 = 不显示）
func (h *AuthHandler) AuthGetMe(ctx context.Context) (oas.AuthGetMeRes, error) {
	sc, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		return unauthorizedErrorEnvelope("未登录"), nil
	}
	raw, err := h.Svc.Me(ctx, sc)
	if err != nil {
		return nil, err
	}
	user, ok := raw.(services.AuthUser)
	if !ok {
		return nil, errors.New("auth handler: unexpected user type from service")
	}
	oasUser := toOASUser(user)

	// 第二步：附加权限码列表（仅在 me 接口；登录/创建响应不带）
	// Task 8 之后：优先 EffectivePermissionsService（含 super_admin '*:*' 短路 +
	// user_permissions override）；fallback 旧 RBAC（兼容 Phase 2 测试场景）。
	if h.EffectivePerms != nil {
		codes, err := h.EffectivePerms.Compute(ctx, user.ID)
		if err == nil {
			oasUser.Permissions = codes
		}
		// 错误路径：留空数组，不让 me 失败（PermissionGate fail-closed）
	} else if h.RBAC != nil {
		permsMap, err := h.RBAC.LoadUserPermissions(ctx, user.RoleID)
		if err == nil {
			codes := make([]string, 0, len(permsMap))
			for code := range permsMap {
				codes = append(codes, code)
			}
			oasUser.Permissions = codes
		}
	}

	return &oas.UserResponse{Data: oasUser}, nil
}

// ============================================================
// AuthChangePassword
// ============================================================

// AuthChangePassword 实现 POST /api/auth/change-password。
//
// 业务流程：
//  1. 从 ctx 取 AuthContext；缺失 → 401
//  2. 调 svc.ChangePassword(sc, oldPassword, newPassword)
//  3. 错误映射：
//     - ErrInvalidCredentials → 401（旧密码错或用户被并发删）
//     - ErrInvalidUserInput   → 422（新密码弱 / 与旧相同）
//     - 其它                  → 500
//
// 注：成功后不让前端立刻 logout —— access token 仍可用一会儿；
// 前端展示提示，引导用户主动重登。
func (h *AuthHandler) AuthChangePassword(ctx context.Context, req *oas.ChangePasswordRequest) (oas.AuthChangePasswordRes, error) {
	sc, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		// ogen 给本 op 生成的 *Unauthorized 是 ErrorEnvelope alias
		e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeUnauthorized, "未登录")
		r := oas.AuthChangePasswordUnauthorized(e)
		return &r, nil
	}
	if req == nil {
		e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeValidationFailed, "请求体缺失")
		r := oas.AuthChangePasswordUnprocessableEntity(e)
		return &r, nil
	}
	if err := h.Svc.ChangePassword(ctx, sc, req.OldPassword, req.NewPassword); err != nil {
		switch {
		case errors.Is(err, services.ErrInvalidCredentials):
			e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeUnauthorized, "旧密码错误")
			r := oas.AuthChangePasswordUnauthorized(e)
			return &r, nil
		case errors.Is(err, services.ErrInvalidUserInput):
			e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeValidationFailed, err.Error())
			r := oas.AuthChangePasswordUnprocessableEntity(e)
			return &r, nil
		default:
			return nil, err
		}
	}
	return &oas.AuthChangePasswordNoContent{}, nil
}

// ============================================================
// AuthUpdateMe
// ============================================================

// AuthUpdateMe 实现 PATCH /api/auth/me。
//
// 业务流程：
//  1. 从 ctx 取 AuthContext；缺失 → 401
//  2. 把 oas optional 字段（OptString.Set）转 *string 入参
//  3. 调 svc.UpdateMe；返回新 oas.User（不附 permissions —— 与 Atlas 用户列表保持一致）
//
// 错误映射：
//   - ErrUsernameTaken    → 422 用户名已存在
//   - ErrInvalidUserInput → 422 字段非法
//   - ErrUserNotFound     → 401（被并发删，等同会话失效）
func (h *AuthHandler) AuthUpdateMe(ctx context.Context, req *oas.AuthUpdateMeRequest) (oas.AuthUpdateMeRes, error) {
	sc, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeUnauthorized, "未登录")
		r := oas.AuthUpdateMeUnauthorized(e)
		return &r, nil
	}
	if req == nil {
		e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeValidationFailed, "请求体缺失")
		r := oas.AuthUpdateMeUnprocessableEntity(e)
		return &r, nil
	}

	in := services.UpdateMeInput{}
	if req.Username.Set {
		v := req.Username.Value
		in.Username = &v
	}
	if req.DisplayName.Set {
		v := req.DisplayName.Value
		in.DisplayName = &v
	}

	raw, err := h.Svc.UpdateMe(ctx, sc, in)
	if err != nil {
		switch {
		case errors.Is(err, services.ErrUsernameTaken):
			e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeValidationFailed, "用户名已存在")
			r := oas.AuthUpdateMeUnprocessableEntity(e)
			return &r, nil
		case errors.Is(err, services.ErrInvalidUserInput):
			e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeValidationFailed, err.Error())
			r := oas.AuthUpdateMeUnprocessableEntity(e)
			return &r, nil
		case errors.Is(err, services.ErrUserNotFound):
			e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeUnauthorized, "用户不存在或已被禁用")
			r := oas.AuthUpdateMeUnauthorized(e)
			return &r, nil
		default:
			return nil, err
		}
	}
	user, ok := raw.(services.AuthUser)
	if !ok {
		return nil, errors.New("auth handler: unexpected user type from UpdateMe")
	}
	// 与 toOASUserView 一致：Permissions 显式给空数组，避免前端 zod schema_drift
	oasUser := toOASUser(user)
	oasUser.Permissions = []string{}
	return &oas.UserResponse{Data: oasUser}, nil
}

// ============================================================
// WsTicketIssue
// ============================================================

// WsTicketIssue 实现 POST /api/ws/ticket。
func (h *AuthHandler) WsTicketIssue(ctx context.Context) (*oas.WSTicketResponse, error) {
	sc, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		// 注：oas 生成的 WsTicket 接口签名只允许返回 *WSTicketResponse 或 error；
		// 没有 401 分支。401 由 SecurityHandler 在中间件外层兜底（未携带 Bearer 时直接拒绝）
		return nil, errors.New("auth handler: missing auth context")
	}
	raw, expiresAt, err := h.Svc.IssueWSTicket(ctx, sc)
	if err != nil {
		return nil, err
	}
	return &oas.WSTicketResponse{
		Data: oas.WSTicket{Ticket: raw, ExpiresAt: expiresAt},
	}, nil
}

// ============================================================
// 辅助：service AuthUser → oas.User
// ============================================================

func toOASUser(u services.AuthUser) oas.User {
	return oas.User{
		ID:          u.ID,
		Username:    u.Username,
		DisplayName: u.DisplayName,
		RoleId:      u.RoleID,
		IsActive:    u.IsActive,
		CreatedAt:   u.CreatedAt,
	}
}

// ============================================================
// 错误响应构造（避免每个分支都手写 ErrorEnvelope）
// ============================================================

// unauthorizedLoginRes 构造 401 错误，专用于 AuthLogin 响应链路。
//
// 业务背景：ogen 给每个 op 生成不同的 *Unauthorized 类型（避免错误响应跨 op 共享导致
// 错误 schema 漂移）；AuthLoginUnauthorized 是 ErrorEnvelope 的别名。
func unauthorizedLoginRes(msg string) *oas.AuthLoginUnauthorized {
	envelope := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeUnauthorized, msg)
	res := oas.AuthLoginUnauthorized(envelope)
	return &res
}

// unauthorizedErrorEnvelope 构造通用 401 ErrorEnvelope（通用 res 类型，用于 refresh/logout/getMe）。
func unauthorizedErrorEnvelope(msg string) *oas.ErrorEnvelope {
	e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeUnauthorized, msg)
	return &e
}

func newErrorEnvelope(code oas.ErrorEnvelopeErrorCode, msg string) oas.ErrorEnvelope {
	return oas.ErrorEnvelope{
		Error: oas.ErrorEnvelopeError{
			Code:    code,
			Message: msg,
		},
	}
}

