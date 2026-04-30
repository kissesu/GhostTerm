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
}

// NewAuthHandler 构造 AuthHandler；rbac 允许 nil（Phase 2 时未注入），
// 缺失时 AuthGetMe 不附带 permissions 字段（仍合法，为空数组）。
func NewAuthHandler(svc services.AuthService, rbac services.RBACService) *AuthHandler {
	return &AuthHandler{Svc: svc, RBAC: rbac}
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
	access, refresh, raw, err := h.Svc.Login(ctx, req.Email, req.Password)
	if err != nil {
		if errors.Is(err, services.ErrInvalidCredentials) || errors.Is(err, services.ErrUserInactive) {
			return unauthorizedLoginRes("邮箱或密码错误"), nil
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
	access, err := h.Svc.Refresh(ctx, req.RefreshToken)
	if err != nil {
		if errors.Is(err, services.ErrInvalidRefreshToken) {
			return unauthorizedErrorEnvelope("refresh token 无效或已过期"), nil
		}
		return nil, err
	}
	return &oas.AuthRefreshEnvelope{
		Data: oas.AuthRefreshResponse{AccessToken: access},
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
	if h.RBAC != nil {
		permsMap, err := h.RBAC.LoadUserPermissions(ctx, user.RoleID)
		if err == nil {
			codes := make([]string, 0, len(permsMap))
			for code := range permsMap {
				codes = append(codes, code)
			}
			oasUser.Permissions = codes
		}
		// 错误路径：留空数组（前端 PermissionGate 全部 fail-closed），不让 me 失败
	}

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
		Email:       u.Email,
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

