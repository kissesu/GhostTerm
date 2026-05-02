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
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/ogen-go/ogen/ogenerrors"

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
// Phase 10 Lead wireup：注册 worker B/C/D/E/F 的 handler。
// 注：原 worker A (customer) 已于 2026-04-30 移除（客户降级为 project 字段）。
type oasHandler struct {
	auth         *handlers.AuthHandler
	rbac         *handlers.RBACHandler
	users        *handlers.UsersHandler
	project      *handlers.ProjectHandler
	file         *handlers.FileHandler
	feedback     *handlers.FeedbackHandler
	quote        *handlers.QuoteHandler
	payment      *handlers.PaymentHandler
	earnings     *handlers.EarningsHandler
	notification *handlers.NotificationHandler
	activity     *handlers.ActivityHandler
	// Task 7：权限管理 handler，覆盖 6 个 OAS 端点（/api/permissions、
	// /api/me/effective-permissions、role/user permissions 读写）
	permissions *handlers.PermissionsHandler
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

// PermissionsList 转发到 PermissionsHandler 实现（Task 7：3 段 code 字段需在 handler 拼）
func (h *oasHandler) PermissionsList(ctx context.Context) (oas.PermissionsListRes, error) {
	return h.permissions.PermissionsList(ctx)
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

// RolesUpdatePermissions 转发到 PermissionsHandler 实现（Task 7：复用 PermissionsService
// 自带的 token_version bump + super_admin 拦截）
func (h *oasHandler) RolesUpdatePermissions(ctx context.Context, req *oas.RolePermissionUpdateRequest, params oas.RolesUpdatePermissionsParams) (oas.RolesUpdatePermissionsRes, error) {
	return h.permissions.RolesUpdatePermissions(ctx, req, params)
}

// MeGetEffectivePermissions 转发到 PermissionsHandler 实现（Task 7）
func (h *oasHandler) MeGetEffectivePermissions(ctx context.Context) (oas.MeGetEffectivePermissionsRes, error) {
	return h.permissions.MeGetEffectivePermissions(ctx)
}

// UsersGetPermissionOverrides 转发到 PermissionsHandler 实现（Task 7）
func (h *oasHandler) UsersGetPermissionOverrides(ctx context.Context, params oas.UsersGetPermissionOverridesParams) (oas.UsersGetPermissionOverridesRes, error) {
	return h.permissions.UsersGetPermissionOverrides(ctx, params)
}

// UsersUpdatePermissionOverrides 转发到 PermissionsHandler 实现（Task 7）
func (h *oasHandler) UsersUpdatePermissionOverrides(ctx context.Context, req *oas.UpdateUserPermissionOverridesRequest, params oas.UsersUpdatePermissionOverridesParams) (oas.UsersUpdatePermissionOverridesRes, error) {
	return h.permissions.UsersUpdatePermissionOverrides(ctx, req, params)
}

// ============================================================
// Atlas — Users CRUD（仅超管）：4 个方法 forward
// ============================================================

// UsersList 转发到 UsersHandler 实现
func (h *oasHandler) UsersList(ctx context.Context) (oas.UsersListRes, error) {
	return h.users.UsersList(ctx)
}

// UsersCreate 转发到 UsersHandler 实现
func (h *oasHandler) UsersCreate(ctx context.Context, req *oas.UserCreateRequest) (oas.UsersCreateRes, error) {
	return h.users.UsersCreate(ctx, req)
}

// UsersUpdate 转发到 UsersHandler 实现
func (h *oasHandler) UsersUpdate(ctx context.Context, req *oas.UserUpdateRequest, params oas.UsersUpdateParams) (oas.UsersUpdateRes, error) {
	return h.users.UsersUpdate(ctx, req, params)
}

// UsersDelete 转发到 UsersHandler 实现
func (h *oasHandler) UsersDelete(ctx context.Context, params oas.UsersDeleteParams) (oas.UsersDeleteRes, error) {
	return h.users.UsersDelete(ctx, params)
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

// ProjectsListActivities 转发到 ActivityHandler 实现（进度时间线聚合 7 类事件）
func (h *oasHandler) ProjectsListActivities(ctx context.Context, params oas.ProjectsListActivitiesParams) (oas.ProjectsListActivitiesRes, error) {
	return h.activity.ProjectsListActivities(ctx, params)
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

// ============================================================
// Phase 12 — Notification：3 个 REST 方法 forward
//
// WS endpoint /api/ws/notifications 不走 ogen（chi 直接注册，见 NewRouter）
// ============================================================

// NotificationsList 转发到 NotificationHandler 实现
func (h *oasHandler) NotificationsList(ctx context.Context, params oas.NotificationsListParams) (*oas.NotificationListResponse, error) {
	return h.notification.NotificationsList(ctx, params)
}

// NotificationsMarkRead 转发到 NotificationHandler 实现
func (h *oasHandler) NotificationsMarkRead(ctx context.Context, params oas.NotificationsMarkReadParams) (oas.NotificationsMarkReadRes, error) {
	return h.notification.NotificationsMarkRead(ctx, params)
}

// NotificationsMarkAllRead 转发到 NotificationHandler 实现
func (h *oasHandler) NotificationsMarkAllRead(ctx context.Context) error {
	return h.notification.NotificationsMarkAllRead(ctx)
}

// 编译时校验：oasHandler 满足 oas.Handler 接口（覆盖 worker A-F 全部方法 + Auth + RBAC + Notification）
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
//
// 修正：缺失/无效 token 一律返回 services.ErrInvalidAccessToken，
// 让 errorEnvelopeHandler 映射为 401 unauthorized；
// 之前用裸 errors.New("unauthorized") 会落到 500 internal 兜底。
func (h *oasSecurityHandler) HandleBearerAuth(ctx context.Context, _ oas.OperationName, t oas.BearerAuth) (context.Context, error) {
	if t.Token == "" {
		return ctx, services.ErrInvalidAccessToken
	}
	sc, err := h.svc.VerifyAccessToken(ctx, t.Token)
	if err != nil {
		return ctx, err
	}
	ac, ok := sc.(services.AuthContext)
	if !ok {
		return ctx, services.ErrInvalidAccessToken
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
	Pool                *pgxpool.Pool
	AuthService         services.AuthService
	RBACService         services.RBACService
	UserService         services.UserService
	ProjectService      *services.ProjectServiceImpl
	FileService         services.FileService
	FeedbackService     services.FeedbackService
	QuoteService        *services.QuoteService
	PaymentService      services.PaymentService
	NotificationService services.NotificationService
	WSHub               services.WSHub
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
	if deps.UserService == nil {
		return nil, errors.New("router: UserService is required")
	}
	if deps.Pool == nil {
		return nil, errors.New("router: Pool is required")
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
	if deps.NotificationService == nil {
		return nil, errors.New("router: NotificationService is required")
	}
	if deps.WSHub == nil {
		return nil, errors.New("router: WSHub is required")
	}
	r := chi.NewRouter()

	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	// CORS：开发环境前端在 Tauri WKWebView (tauri://localhost) 或 vite (http://localhost:1420)
	// 跨 origin 调用本服务 :8080 必经 preflight；生产部署应改为白名单具体 origin
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			origin := req.Header.Get("Origin")
			if origin == "" {
				origin = "*"
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Requested-With")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Max-Age", "600")
			if req.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, req)
		})
	})
	// 文件下载安全响应头中间件（v2 part1 §C5）
	// 仅对 GET /api/files/{id} 生效（中间件内部按 path 短路），
	// 必须在 ogen mount 之前注册，否则 ResponseWriter 已被 ogen encoder 接管无法回改 header
	r.Use(handlers.NewDownloadHeaderMiddleware())

	// Task 7：超管不可改约束的"L3 友好 422 中间件"。
	//
	// 必须挂在 ogen mount 之前；中间件按 r.URL.Path + r.Method 自行解析，
	// 不依赖 chi.URLParam，所以与 ogen 路由无耦合。
	// 拦截范围（详见 super_admin_invariants.go）：
	//   POST /api/users (body.roleId==1)
	//   PATCH/PUT /api/users/{id} (body.roleId==1)
	//   PATCH/PUT /api/roles/{id}/permissions (path id==1)
	//   DELETE /api/roles/{id} (path id==1)
	//   PATCH/PUT /api/users/{id}/permission-overrides (target user.role_id==1)
	r.Use(apimw.NewSuperAdminInvariants(deps.Pool).Handler)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	// ============================================================
	// 装配 worker A-F 的 handler
	// ============================================================
	authHandler := handlers.NewAuthHandler(deps.AuthService, deps.RBACService)
	rbacHandler := handlers.NewRBACHandler(deps.RBACService, deps.Pool)
	usersHandler := handlers.NewUsersHandler(deps.UserService)
	projectHandler := handlers.NewProjectHandler(deps.ProjectService)
	fileHandler := handlers.NewFileHandler(deps.FileService)
	feedbackHandler, err := handlers.NewFeedbackHandler(deps.FeedbackService, deps.RBACService)
	if err != nil {
		return nil, err
	}
	quoteHandler := handlers.NewQuoteHandler(deps.QuoteService)
	paymentHandler := handlers.NewPaymentHandler(deps.PaymentService)
	earningsHandler := handlers.NewEarningsHandler(deps.PaymentService)
	notificationHandler := handlers.NewNotificationHandler(deps.NotificationService)
	// Phase 11 Task 8：activity handler（聚合时间线 GET /api/projects/{id}/activities）
	// service 由 deps 装配；缺失即启动期 error，避免运行时 nil deref
	activitySvc := services.NewActivityService(deps.Pool)
	activityHandler, err := handlers.NewActivityHandler(activitySvc)
	if err != nil {
		return nil, err
	}

	// Task 7：权限管理 handler 装配 PermissionsService + EffectivePermissionsService
	// 不放进 RouterDeps：两个 service 都是 pool-backed 无状态，直接 in-place 构造避免
	// 让 main.go 关心额外的 wiring；与 activitySvc 的处理一致。
	permsSvc := services.NewPermissionsService(deps.Pool)
	effSvc := services.NewEffectivePermissionsService(deps.Pool)
	permissionsHandler := handlers.NewPermissionsHandler(deps.Pool, permsSvc, effSvc)

	secHandler := &oasSecurityHandler{svc: deps.AuthService}

	oasServer, err := oas.NewServer(
		&oasHandler{
			auth:         authHandler,
			rbac:         rbacHandler,
			users:        usersHandler,
			project:      projectHandler,
			file:         fileHandler,
			feedback:     feedbackHandler,
			quote:        quoteHandler,
			payment:      paymentHandler,
			earnings:     earningsHandler,
			notification: notificationHandler,
			activity:     activityHandler,
			permissions:  permissionsHandler,
		},
		secHandler,
		oas.WithErrorHandler(errorEnvelopeHandler),
	)
	if err != nil {
		return nil, err
	}

	// ============================================================
	// WS endpoint：必须在 r.Mount("/") 之前注册，否则 ogen handler 会先匹配
	// （chi router 按注册顺序解析具体路径优先于 mount 子树）
	//
	// 协议：GET /api/ws/notifications?ticket=<base64url> → upgrade 后服务端单向推送
	// 不走 ogen 因为 ogen 不支持 WS 升级；openapi.yaml 中仅声明该 endpoint 元数据
	// ============================================================
	r.Get("/api/ws/notifications", handlers.NewWSHandler(deps.AuthService, deps.WSHub))

	r.Mount("/", oasServer)
	return r, nil
}

// errorEnvelopeHandler 把 handler / SecurityHandler 抛出的 error 映射为 ErrorEnvelope JSON。
//
// 业务背景：
//   - service 层的 sentinel error（ErrInvalidAccessToken / ErrInvalidWSTicket 等）
//     代表已知业务失败；HTTP 应映射为 401 / 400 而非 500
//   - ogen 框架包装为 *ogenerrors.SecurityError 时其 Code() = 401，需特例化映射
//   - 未知 error 兜底 500 + code=internal，避免泄漏内部细节
func errorEnvelopeHandler(_ context.Context, w http.ResponseWriter, r *http.Request, err error) {
	// 关键观察性：始终 log 原始 error，envelope 仅给 client 看脱敏 message
	log.Printf("[ogen-error] %s %s: %v", r.Method, r.URL.Path, err)

	status := http.StatusInternalServerError
	code := string(oas.ErrorEnvelopeErrorCodeInternal)
	msg := "internal server error"

	// ogen SecurityError → 401（含"missing Authorization header"）
	var secErr *ogenerrors.SecurityError
	if errors.As(err, &secErr) {
		status = http.StatusUnauthorized
		code = string(oas.ErrorEnvelopeErrorCodeUnauthorized)
		msg = "未登录或会话已失效"
	}

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
	// Task 7：权限管理 sentinel 兜底（permissions handler 已先翻译为对应 OAS Res，
	// 不应走到这里；保留是防 handler 漏 case 时仍有合理 HTTP code）
	case errors.Is(err, services.ErrSuperAdminImmutable):
		status = http.StatusUnprocessableEntity
		code = string(oas.ErrorEnvelopeErrorCodeSuperAdminImmutable)
		msg = "禁止修改 super_admin"
	case errors.Is(err, services.ErrInvalidEffect):
		status = http.StatusUnprocessableEntity
		code = string(oas.ErrorEnvelopeErrorCodeInvalidEffect)
		msg = "effect 必须是 grant 或 deny"
	case errors.Is(err, services.ErrRoleNotFound):
		status = http.StatusNotFound
		code = string(oas.ErrorEnvelopeErrorCodeNotFound)
		msg = "角色不存在"
	case errors.Is(err, services.ErrUserNotFound):
		status = http.StatusNotFound
		code = string(oas.ErrorEnvelopeErrorCodeNotFound)
		msg = "用户不存在"
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
