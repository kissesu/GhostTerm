/*
@file router.go
@description chi 路由 + ogen 生成的 OpenAPI server 装载入口。
             Phase 2 起：AuthHandler 嵌入 oasHandler，5 个 auth 方法（Login/Refresh/Logout/Me/WsTicket）
             有了真实实现；其它 endpoint 仍由 oas.UnimplementedHandler 默认返回 ErrNotImplemented。

             鉴权链路：ogen SecurityHandler 实现里调 services.AuthService.VerifyAccessToken，
             校验通过后通过 middleware.WithAuthContext 把 AuthContext 注入到 ctx。handler 入口
             用 middleware.AuthContextFrom 取出。AuthLogin / AuthRefresh 在 OpenAPI 里没声明
             security，ogen 自动跳过 SecurityHandler，所以登录/刷新无需 token 即可访问。
@author Atlas.oi
@date 2026-04-29
*/

package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ghostterm/progress-server/internal/api/handlers"
	apimw "github.com/ghostterm/progress-server/internal/api/middleware"
	"github.com/ghostterm/progress-server/internal/api/oas"
	"github.com/ghostterm/progress-server/internal/services"
)

// ErrNotImplementedYet 是 skeleton 阶段所有未实现 endpoint 的统一错误。
//
// v2 part3 §AB1 明确要求：router 不允许 panic("TODO")。
// Phase 2 已替换 5 个 auth 方法为真实实现；其它 endpoint 由 UnimplementedHandler 兜底。
var ErrNotImplementedYet = errors.New("not_implemented_yet")

// oasHandler 嵌入 ogen UnimplementedHandler 拿到所有"默认返回 ErrNotImplemented"的方法，
// 通过持有 *handlers.AuthHandler / *handlers.RBACHandler 字段并显式 forward 真实方法来覆盖默认实现。
//
// 注：Go 嵌入字段的"方法 ambiguous selector"规则会让"两个嵌入字段同名方法"导致编译失败；
// 因此 AuthHandler / RBACHandler 不嵌入而是作为命名字段，由 oasHandler 自己声明方法做显式 forward。
// 后续 phase 的 worker 会再持有 *CustomerHandler / *ProjectHandler 字段并 forward 各自方法。
type oasHandler struct {
	auth *handlers.AuthHandler
	rbac *handlers.RBACHandler
	oas.UnimplementedHandler
}

// AuthLogin 转发到 AuthHandler 实现（覆盖 UnimplementedHandler 的默认 ErrNotImplemented）
func (h *oasHandler) AuthLogin(ctx context.Context, req *oas.AuthLoginRequest) (oas.AuthLoginRes, error) {
	return h.auth.AuthLogin(ctx, req)
}

// AuthRefresh 转发到 AuthHandler 实现
func (h *oasHandler) AuthRefresh(ctx context.Context, req *oas.AuthRefreshRequest) (oas.AuthRefreshRes, error) {
	return h.auth.AuthRefresh(ctx, req)
}

// AuthLogout 转发到 AuthHandler 实现
func (h *oasHandler) AuthLogout(ctx context.Context) (oas.AuthLogoutRes, error) {
	return h.auth.AuthLogout(ctx)
}

// AuthGetMe 转发到 AuthHandler 实现
func (h *oasHandler) AuthGetMe(ctx context.Context) (oas.AuthGetMeRes, error) {
	return h.auth.AuthGetMe(ctx)
}

// WsTicketIssue 转发到 AuthHandler 实现
func (h *oasHandler) WsTicketIssue(ctx context.Context) (*oas.WSTicketResponse, error) {
	return h.auth.WsTicketIssue(ctx)
}

// PermissionsList 转发到 RBACHandler 实现
func (h *oasHandler) PermissionsList(ctx context.Context) (oas.PermissionsListRes, error) {
	return h.rbac.PermissionsList(ctx)
}

// RolesList 转发到 RBACHandler 实现
func (h *oasHandler) RolesList(ctx context.Context) (oas.RolesListRes, error) {
	return h.rbac.RolesList(ctx)
}

// RolesCreate 转发到 RBACHandler 实现
func (h *oasHandler) RolesCreate(ctx context.Context, req *oas.RoleCreateRequest) (oas.RolesCreateRes, error) {
	return h.rbac.RolesCreate(ctx, req)
}

// RolesGetPermissions 转发到 RBACHandler 实现
func (h *oasHandler) RolesGetPermissions(ctx context.Context, params oas.RolesGetPermissionsParams) (oas.RolesGetPermissionsRes, error) {
	return h.rbac.RolesGetPermissions(ctx, params)
}

// RolesUpdatePermissions 转发到 RBACHandler 实现
func (h *oasHandler) RolesUpdatePermissions(ctx context.Context, req *oas.RolePermissionUpdateRequest, params oas.RolesUpdatePermissionsParams) (oas.RolesUpdatePermissionsRes, error) {
	return h.rbac.RolesUpdatePermissions(ctx, req, params)
}

// 编译时校验：oasHandler 仍满足 oas.Handler 接口（含 Auth + RBAC 方法的真实实现）
var _ oas.Handler = (*oasHandler)(nil)

// oasSecurityHandler 实现 ogen 的 SecurityHandler。
//
// 业务流程：
//  1. ogen 在调 op handler 前，先把 Authorization 头里的 Bearer token 传给本 struct
//  2. 调 svc.VerifyAccessToken 完成签名 + token_version + is_active 三层校验
//  3. 把 AuthContext 注入 ctx，op handler 通过 middleware.AuthContextFrom 取出
//  4. 校验失败返回 error，ogen 框架透传到 ErrorHandler，写为 401 ErrorEnvelope
type oasSecurityHandler struct {
	svc services.AuthService
}

// HandleBearerAuth 是 ogen SecurityHandler 接口方法。
func (h *oasSecurityHandler) HandleBearerAuth(ctx context.Context, _ oas.OperationName, t oas.BearerAuth) (context.Context, error) {
	if t.Token == "" {
		return ctx, errors.New("unauthorized")
	}
	sc, err := h.svc.VerifyAccessToken(ctx, t.Token)
	if err != nil {
		return ctx, err
	}
	ac, ok := sc.(services.AuthContext)
	if !ok {
		return ctx, errors.New("unauthorized")
	}
	return apimw.WithAuthContext(ctx, ac), nil
}

// 编译时校验
var _ oas.SecurityHandler = (*oasSecurityHandler)(nil)

// RouterDeps 装配 NewRouter 所需依赖。
//
// 业务背景：相比 Phase 0a 的"无参 NewRouter"，Phase 2 起 router 需要 service 层来源；
// 把它收敛到一个 deps struct 让后续 phase 加 service 时不破坏 main.go 的调用签名。
//
// Phase 3 起：必须传 RBACService；缺失时 NewRouter 返回错误。
type RouterDeps struct {
	Pool        *pgxpool.Pool
	AuthService services.AuthService
	RBACService services.RBACService
}

// NewRouter 装配 chi 基础中间件 + ogen 生成的 OpenAPI server。
//
// 业务流程：
//  1. 注册 chi 基础中间件（RequestID / RealIP / Logger / Recoverer）
//  2. 暴露 /healthz（main.go 还会再覆盖一份带 DB ping 的）
//  3. 用 ogen NewServer 装配 oasHandler + oasSecurityHandler
//  4. 自定义 ErrorHandler：把 service sentinel error 映射为对应 HTTP 状态 + ErrorEnvelope
func NewRouter(deps RouterDeps) (http.Handler, error) {
	if deps.AuthService == nil {
		return nil, errors.New("router: AuthService is required")
	}
	if deps.RBACService == nil {
		return nil, errors.New("router: RBACService is required")
	}
	if deps.Pool == nil {
		return nil, errors.New("router: Pool is required")
	}
	r := chi.NewRouter()

	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	authHandler := handlers.NewAuthHandler(deps.AuthService, deps.RBACService)
	rbacHandler := handlers.NewRBACHandler(deps.RBACService, deps.Pool)
	secHandler := &oasSecurityHandler{svc: deps.AuthService}

	oasServer, err := oas.NewServer(
		&oasHandler{auth: authHandler, rbac: rbacHandler},
		secHandler,
		oas.WithErrorHandler(errorEnvelopeHandler),
	)
	if err != nil {
		return nil, err
	}

	r.Mount("/", oasServer)
	return r, nil
}

// errorEnvelopeHandler 把 handler / SecurityHandler 抛出的 error 映射为 ErrorEnvelope JSON。
//
// 业务背景：
//   - service 层的 sentinel error（ErrInvalidAccessToken / ErrInvalidWSTicket 等）
//     代表已知业务失败；HTTP 应映射为 401 / 400 而非 500
//   - 未知 error 兜底 500 + code=internal，避免泄漏内部细节
func errorEnvelopeHandler(_ context.Context, w http.ResponseWriter, _ *http.Request, err error) {
	status := http.StatusInternalServerError
	code := string(oas.ErrorEnvelopeErrorCodeInternal)
	msg := "internal server error"

	switch {
	case errors.Is(err, services.ErrInvalidAccessToken),
		errors.Is(err, services.ErrInvalidRefreshToken),
		errors.Is(err, services.ErrInvalidCredentials),
		errors.Is(err, services.ErrUserInactive):
		status = http.StatusUnauthorized
		code = string(oas.ErrorEnvelopeErrorCodeUnauthorized)
		msg = "未登录或会话已失效"
	case errors.Is(err, services.ErrInvalidWSTicket):
		status = http.StatusUnauthorized
		code = string(oas.ErrorEnvelopeErrorCodeTicketInvalid)
		msg = "WS ticket 无效或已过期"
	case errors.Is(err, ErrNotImplementedYet):
		status = http.StatusNotImplemented
		code = string(oas.ErrorEnvelopeErrorCodeNotImplemented)
		msg = "尚未实现"
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	body := map[string]any{
		"error": map[string]any{
			"code":    code,
			"message": msg,
		},
	}
	_ = json.NewEncoder(w).Encode(body)
}
