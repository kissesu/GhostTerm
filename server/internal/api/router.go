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
// 通过持有各业务 handler 字段并显式 forward 真实方法来覆盖默认实现。
//
// 注：Go 嵌入字段的"方法 ambiguous selector"规则会让"两个嵌入字段同名方法"导致编译失败；
// 因此各 handler 不嵌入而是作为命名字段，由 oasHandler 自己声明方法做显式 forward。
// Phase 10 Lead wireup：注册 worker A/B/C/D/E/F 的全部 handler。
type oasHandler struct {
	auth     *handlers.AuthHandler
	rbac     *handlers.RBACHandler
	customer *handlers.CustomerHandler
	project  *handlers.ProjectHandler
	file     *handlers.FileHandler
	feedback *handlers.FeedbackHandler
	quote    *handlers.QuoteHandler
	payment  *handlers.PaymentHandler
	earnings *handlers.EarningsHandler
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

// ============================================================
// Worker A — Customer：4 个方法 forward
// ============================================================

// CustomersList 转发到 CustomerHandler 实现
func (h *oasHandler) CustomersList(ctx context.Context) (oas.CustomersListRes, error) {
	return h.customer.CustomersList(ctx)
}

// CustomersGet 转发到 CustomerHandler 实现
func (h *oasHandler) CustomersGet(ctx context.Context, params oas.CustomersGetParams) (oas.CustomersGetRes, error) {
	return h.customer.CustomersGet(ctx, params)
}

// CustomersCreate 转发到 CustomerHandler 实现
func (h *oasHandler) CustomersCreate(ctx context.Context, req *oas.CustomerCreateRequest) (oas.CustomersCreateRes, error) {
	return h.customer.CustomersCreate(ctx, req)
}

// CustomersUpdate 转发到 CustomerHandler 实现
func (h *oasHandler) CustomersUpdate(ctx context.Context, req *oas.CustomerUpdateRequest, params oas.CustomersUpdateParams) (oas.CustomersUpdateRes, error) {
	return h.customer.CustomersUpdate(ctx, req, params)
}

// ============================================================
// Worker B — Project + StateMachine：6 个方法 forward
// ============================================================

// ProjectsList 转发到 ProjectHandler 实现
func (h *oasHandler) ProjectsList(ctx context.Context, params oas.ProjectsListParams) (oas.ProjectsListRes, error) {
	return h.project.ProjectsList(ctx, params)
}

// ProjectsCreate 转发到 ProjectHandler 实现
func (h *oasHandler) ProjectsCreate(ctx context.Context, req *oas.ProjectCreateRequest) (oas.ProjectsCreateRes, error) {
	return h.project.ProjectsCreate(ctx, req)
}

// ProjectsGet 转发到 ProjectHandler 实现
func (h *oasHandler) ProjectsGet(ctx context.Context, params oas.ProjectsGetParams) (oas.ProjectsGetRes, error) {
	return h.project.ProjectsGet(ctx, params)
}

// ProjectsUpdate 转发到 ProjectHandler 实现
func (h *oasHandler) ProjectsUpdate(ctx context.Context, req *oas.ProjectUpdateRequest, params oas.ProjectsUpdateParams) (oas.ProjectsUpdateRes, error) {
	return h.project.ProjectsUpdate(ctx, req, params)
}

// ProjectsTriggerEvent 转发到 ProjectHandler 实现
func (h *oasHandler) ProjectsTriggerEvent(ctx context.Context, req *oas.EventTriggerRequest, params oas.ProjectsTriggerEventParams) (oas.ProjectsTriggerEventRes, error) {
	return h.project.ProjectsTriggerEvent(ctx, req, params)
}

// ProjectsStatusChanges 转发到 ProjectHandler 实现
func (h *oasHandler) ProjectsStatusChanges(ctx context.Context, params oas.ProjectsStatusChangesParams) (oas.ProjectsStatusChangesRes, error) {
	return h.project.ProjectsStatusChanges(ctx, params)
}

// ============================================================
// Worker C — File：5 个方法 forward
// ============================================================

// FilesUpload 转发到 FileHandler 实现
func (h *oasHandler) FilesUpload(ctx context.Context, req *oas.FilesUploadReq) (oas.FilesUploadRes, error) {
	return h.file.FilesUpload(ctx, req)
}

// FilesDownload 转发到 FileHandler 实现
func (h *oasHandler) FilesDownload(ctx context.Context, params oas.FilesDownloadParams) (oas.FilesDownloadRes, error) {
	return h.file.FilesDownload(ctx, params)
}

// ProjectsListFiles 转发到 FileHandler 实现
func (h *oasHandler) ProjectsListFiles(ctx context.Context, params oas.ProjectsListFilesParams) (*oas.ProjectFileListResponse, error) {
	return h.file.ProjectsListFiles(ctx, params)
}

// ProjectsCreateThesisVersion 转发到 FileHandler 实现
func (h *oasHandler) ProjectsCreateThesisVersion(ctx context.Context, req *oas.ThesisVersionCreateRequest, params oas.ProjectsCreateThesisVersionParams) (oas.ProjectsCreateThesisVersionRes, error) {
	return h.file.ProjectsCreateThesisVersion(ctx, req, params)
}

// ProjectsListThesisVersions 转发到 FileHandler 实现
func (h *oasHandler) ProjectsListThesisVersions(ctx context.Context, params oas.ProjectsListThesisVersionsParams) (*oas.ThesisVersionListResponse, error) {
	return h.file.ProjectsListThesisVersions(ctx, params)
}

// ============================================================
// Worker D — Feedback：3 个方法 forward
// ============================================================

// ProjectsListFeedbacks 转发到 FeedbackHandler 实现
func (h *oasHandler) ProjectsListFeedbacks(ctx context.Context, params oas.ProjectsListFeedbacksParams) (*oas.FeedbackListResponse, error) {
	return h.feedback.ProjectsListFeedbacks(ctx, params)
}

// ProjectsCreateFeedback 转发到 FeedbackHandler 实现
func (h *oasHandler) ProjectsCreateFeedback(ctx context.Context, req *oas.FeedbackCreateRequest, params oas.ProjectsCreateFeedbackParams) (oas.ProjectsCreateFeedbackRes, error) {
	return h.feedback.ProjectsCreateFeedback(ctx, req, params)
}

// FeedbacksUpdate 转发到 FeedbackHandler 实现
func (h *oasHandler) FeedbacksUpdate(ctx context.Context, req *oas.FeedbackUpdateRequest, params oas.FeedbacksUpdateParams) (oas.FeedbacksUpdateRes, error) {
	return h.feedback.FeedbacksUpdate(ctx, req, params)
}

// ============================================================
// Worker E — Quote：2 个方法 forward
// ============================================================

// ProjectsListQuoteChanges 转发到 QuoteHandler 实现
func (h *oasHandler) ProjectsListQuoteChanges(ctx context.Context, params oas.ProjectsListQuoteChangesParams) (*oas.QuoteChangeListResponse, error) {
	return h.quote.ProjectsListQuoteChanges(ctx, params)
}

// ProjectsCreateQuoteChange 转发到 QuoteHandler 实现
func (h *oasHandler) ProjectsCreateQuoteChange(ctx context.Context, req *oas.QuoteChangeRequest, params oas.ProjectsCreateQuoteChangeParams) (oas.ProjectsCreateQuoteChangeRes, error) {
	return h.quote.ProjectsCreateQuoteChange(ctx, req, params)
}

// ============================================================
// Worker F — Payment + Earnings：3 个方法 forward
// ============================================================

// ProjectsListPayments 转发到 PaymentHandler 实现
func (h *oasHandler) ProjectsListPayments(ctx context.Context, params oas.ProjectsListPaymentsParams) (*oas.PaymentListResponse, error) {
	return h.payment.ProjectsListPayments(ctx, params)
}

// ProjectsCreatePayment 转发到 PaymentHandler 实现
func (h *oasHandler) ProjectsCreatePayment(ctx context.Context, req *oas.PaymentCreateRequest, params oas.ProjectsCreatePaymentParams) (oas.ProjectsCreatePaymentRes, error) {
	return h.payment.ProjectsCreatePayment(ctx, req, params)
}

// MeEarnings 转发到 EarningsHandler 实现
func (h *oasHandler) MeEarnings(ctx context.Context) (*oas.EarningsSummaryResponse, error) {
	return h.earnings.MeEarnings(ctx)
}

// 编译时校验：oasHandler 满足 oas.Handler 接口（覆盖 worker A-F 全部方法 + Auth + RBAC）
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
// Phase 3 起：必须传 RBACService。
// Phase 10 Lead wireup：增加 worker A-F 的全部 service 依赖，缺失即返回 error。
type RouterDeps struct {
	Pool            *pgxpool.Pool
	AuthService     services.AuthService
	RBACService     services.RBACService
	CustomerService services.CustomerService
	ProjectService  *services.ProjectServiceImpl
	FileService     services.FileService
	FeedbackService services.FeedbackService
	QuoteService    *services.QuoteService
	PaymentService  services.PaymentService
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
	if deps.CustomerService == nil {
		return nil, errors.New("router: CustomerService is required")
	}
	if deps.ProjectService == nil {
		return nil, errors.New("router: ProjectService is required")
	}
	if deps.FileService == nil {
		return nil, errors.New("router: FileService is required")
	}
	if deps.FeedbackService == nil {
		return nil, errors.New("router: FeedbackService is required")
	}
	if deps.QuoteService == nil {
		return nil, errors.New("router: QuoteService is required")
	}
	if deps.PaymentService == nil {
		return nil, errors.New("router: PaymentService is required")
	}
	r := chi.NewRouter()

	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	// 文件下载安全响应头中间件（v2 part1 §C5）
	// 仅对 GET /api/files/{id} 生效（中间件内部按 path 短路），
	// 必须在 ogen mount 之前注册，否则 ResponseWriter 已被 ogen encoder 接管无法回改 header
	r.Use(handlers.NewDownloadHeaderMiddleware())

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	// ============================================================
	// 装配 worker A-F 的 handler
	// ============================================================
	authHandler := handlers.NewAuthHandler(deps.AuthService, deps.RBACService)
	rbacHandler := handlers.NewRBACHandler(deps.RBACService, deps.Pool)
	customerHandler := handlers.NewCustomerHandler(deps.CustomerService)
	projectHandler := handlers.NewProjectHandler(deps.ProjectService)
	fileHandler := handlers.NewFileHandler(deps.FileService)
	feedbackHandler, err := handlers.NewFeedbackHandler(deps.FeedbackService, deps.RBACService)
	if err != nil {
		return nil, err
	}
	quoteHandler := handlers.NewQuoteHandler(deps.QuoteService)
	paymentHandler := handlers.NewPaymentHandler(deps.PaymentService)
	earningsHandler := handlers.NewEarningsHandler(deps.PaymentService)

	secHandler := &oasSecurityHandler{svc: deps.AuthService}

	oasServer, err := oas.NewServer(
		&oasHandler{
			auth:     authHandler,
			rbac:     rbacHandler,
			customer: customerHandler,
			project:  projectHandler,
			file:     fileHandler,
			feedback: feedbackHandler,
			quote:    quoteHandler,
			payment:  paymentHandler,
			earnings: earningsHandler,
		},
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
