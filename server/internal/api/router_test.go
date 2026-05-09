/*
@file router_test.go
@description router 层 review 修复回归测试 —— 覆盖 C1（DB 故障 503）+ C2（用户被删 401）。

业务背景：
  C1 review 发现 HandleBearerAuth.eff.Compute 返回 DB error 时，errorEnvelopeHandler
  落到 SecurityError 分支映射为 401，前端会触发 silent refresh → DB 仍 down → 死循环。
  修复：Compute 包成 ErrEffectivePermissionsUnavailable 哨兵，errorEnvelopeHandler
  映射为 503 让前端正确退避。

  C2 review 发现 token 校验通过后用户被并发删除时，eff.Compute 返 ErrUserNotFound，
  errorEnvelopeHandler 把它映射为 404，前端不会触发 logout。
  修复：HandleBearerAuth 把 ErrUserNotFound 翻译为 ErrInvalidAccessToken → 401 触发登出。

测试设计：
  - C1 单测：直接 unit test errorEnvelopeHandler，验证 sentinel → 503 映射
  - C1 + C2 SecurityHandler 单测：用 fake EffectivePermissionsService 直接调
    HandleBearerAuth，验证返回 error 满足 errors.Is(...)
  - C2 集成测试：完整 router 经 dockertest postgres，登录 → 删用户 → 调 /api/me/effective-permissions
    → 期望 401 而非 404

@author Atlas.oi
@date 2026-05-02
*/

package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/ogen-go/ogen/ogenerrors"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"github.com/ghostterm/progress-server/internal/api/oas"
	"github.com/ghostterm/progress-server/internal/auth"
	"github.com/ghostterm/progress-server/internal/services"
	"github.com/ghostterm/progress-server/internal/testutil"
	"github.com/ghostterm/progress-server/tests/fixtures"
)

// ============================================================
// 测试用 fake EffectivePermissionsService
// ============================================================

// stubEffSvc 注入预设错误或预设返回值，绕过 DB。
type stubEffSvc struct {
	err   error
	perms []string
}

func (s *stubEffSvc) Compute(_ context.Context, _ int64) ([]string, error) {
	if s.err != nil {
		return nil, s.err
	}
	return s.perms, nil
}

// ============================================================
// C1 unit：errorEnvelopeHandler 把 ErrEffectivePermissionsUnavailable 映射为 503
// ============================================================

func TestErrorEnvelopeHandler_PermsUnavailableMapsTo503(t *testing.T) {
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/me/effective-permissions", nil)

	// 模拟 ogen 实际抛出的 error 结构：HandleBearerAuth wrap 后 ogen 再 wrap SecurityError
	// 即使外层是 SecurityError，errors.Is 也能透过 %w 识别 sentinel
	innerErr := fmt.Errorf("rbac: load effective permissions: %w", services.ErrEffectivePermissionsUnavailable)
	wrappedErr := &ogenerrors.SecurityError{OperationContext: ogenerrors.OperationContext{}, Err: innerErr}

	errorEnvelopeHandler(context.Background(), w, r, wrappedErr)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code,
		"DB 故障必须返回 503 而非 401，避免前端 silent refresh 死循环")

	var envelope struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&envelope))
	assert.Equal(t, "service_unavailable", envelope.Error.Code)
}

// ============================================================
// C1 SecurityHandler unit：DB error 透传 ErrEffectivePermissionsUnavailable
// ============================================================

func TestRouter_HandleBearerAuth_PermsDBErrorReturnsUnavailableSentinel(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	authSvc := newTestAuthService(t, tdb.Pool)
	// admin 用户已由 0001 migration 预置；0021 把默认密码 hash 置 NULL，
	// 测试侧需要 reseed 一个临时密码才能 Login 拿 token
	const adminUsername = "admin"
	const adminPassword = "admin-test-pwd-123"
	reseedAdminPassword(t, ctx, tdb.Pool, adminPassword)
	access, _, _, err := authSvc.Login(ctx, adminUsername, adminPassword)
	require.NoError(t, err)

	// 注入 fake eff 模拟 DB 故障
	effFail := &stubEffSvc{err: fmt.Errorf("simulated DB down: %w", services.ErrEffectivePermissionsUnavailable)}
	sh := &oasSecurityHandler{svc: authSvc, eff: effFail}

	_, gotErr := sh.HandleBearerAuth(ctx, "", oas.BearerAuth{Token: access})
	require.Error(t, gotErr)
	require.True(t, errors.Is(gotErr, services.ErrEffectivePermissionsUnavailable),
		"必须透传 ErrEffectivePermissionsUnavailable 让 errorEnvelopeHandler 映射 503；实际 %v", gotErr)
	require.False(t, errors.Is(gotErr, services.ErrInvalidAccessToken),
		"DB 故障不应被误判为 invalid token")
}

// ============================================================
// C2 SecurityHandler unit：ErrUserNotFound → ErrInvalidAccessToken
// ============================================================

func TestRouter_HandleBearerAuth_DeletedUserMapsToInvalidToken(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	authSvc := newTestAuthService(t, tdb.Pool)
	// 0021 把 0001 默认 admin 的 password_hash 置 NULL；测试需要 reseed 才能 Login
	reseedAdminPassword(t, ctx, tdb.Pool, "admin-test-pwd-123")
	access, _, _, err := authSvc.Login(ctx, "admin", "admin-test-pwd-123")
	require.NoError(t, err)

	// 模拟 token 校验后用户被删的竞态：eff.Compute 返 ErrUserNotFound
	effDeleted := &stubEffSvc{err: fmt.Errorf("user gone: %w", services.ErrUserNotFound)}
	sh := &oasSecurityHandler{svc: authSvc, eff: effDeleted}

	_, gotErr := sh.HandleBearerAuth(ctx, "", oas.BearerAuth{Token: access})
	require.Error(t, gotErr)
	require.True(t, errors.Is(gotErr, services.ErrInvalidAccessToken),
		"用户被删必须翻译为 ErrInvalidAccessToken 让前端登出；实际 %v", gotErr)
	require.False(t, errors.Is(gotErr, services.ErrUserNotFound),
		"必须 NOT 透传 ErrUserNotFound（否则会被映射为 404，前端不登出）")
}

// ============================================================
// C2 集成：完整 router 端到端 — 登录 → 删用户 → 期望 401（非 404）
// ============================================================
//
// 注：这条 e2e 路径实际命中 VerifyAccessToken 的 ErrNoRows → ErrInvalidAccessToken 分支
// （VerifyAccessToken 在 eff.Compute 之前；用户被删时它先抛 401）。eff.Compute 的
// ErrUserNotFound → ErrInvalidAccessToken 翻译只在"VerifyAccessToken 通过到 Compute
// 失败之间被并发删"的窄窗口生效，由上面的 unit test 直接覆盖。
//
// 本集成用例的价值：保证"删用户"这条端到端路径不会让前端拿到 404；任何回归
// （例如有人不小心改 VerifyAccessToken 让 ErrNoRows → ErrUserNotFound 暴露）会被立即抓住。

func TestRouter_DeletedUserReturns401Integration(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	// 1. seed 一个 dev 用户（不能删 admin，因为 admin 是 super_admin 受 trigger 保护）
	const devPassword = "S3cret-pa55"
	hash, err := auth.HashPassword(devPassword, bcrypt.MinCost)
	require.NoError(t, err)
	const devUsername = "dev-c2-deleted"
	var devID int64
	err = tdb.Pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, display_name, role_id, is_active)
		VALUES ($1, $2, 'Dev C2 deleted', 2, TRUE)
		RETURNING id
	`, devUsername, hash).Scan(&devID)
	require.NoError(t, err)

	// 2. 装真实 router；登录拿 access token
	router := buildC2TestRouter(t, tdb.Pool)
	ts := httptest.NewServer(router)
	defer ts.Close()

	access := loginAndGetAccess(t, ts, devUsername, devPassword)

	// 3. 删用户（绕过 super_admin 保护：dev 不是超管）
	_, err = tdb.Pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, devID)
	require.NoError(t, err)

	// 4. 用同一个 access token 调受保护接口；期望 401（被 C2 修复翻译）
	req, err := http.NewRequest(http.MethodGet, ts.URL+"/api/me/effective-permissions", nil)
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer "+access)
	resp, err := ts.Client().Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode,
		"用户被删时必须返回 401 unauthorized 让前端登出；实际 %d", resp.StatusCode)

	var envelope struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&envelope))
	assert.Equal(t, "unauthorized", envelope.Error.Code,
		"error code 必须是 unauthorized 让前端清 session；不能是 not_found")
}

// ============================================================
// 测试辅助：构造完整 router + 登录获取 access token
// ============================================================

// newTestAuthService 构造一个测试用 AuthService（与 buildC2TestRouter 用同款配置）。
func newTestAuthService(t *testing.T, pool *pgxpool.Pool) services.AuthService {
	t.Helper()
	svc, err := services.NewAuthService(services.AuthServiceDeps{
		Pool:          pool,
		AccessSecret:  []byte("test-access-secret-32-bytes-min!!"),
		RefreshSecret: []byte("test-refresh-secret-32-bytes-min!"),
		AccessTTL:     5 * time.Minute,
		RefreshTTL:    24 * time.Hour,
		BcryptCost:    bcrypt.MinCost,
		WSTicketTTL:   30 * time.Second,
	})
	require.NoError(t, err)
	return svc
}

// buildC2TestRouter 装一个最小可路由的 NewRouter；与 handlers/permissions_test.go
// buildPermissionTestRouter 同款逻辑，但 helper 本地化避免跨包调用。
//
// allowedOrigins 可选；nil/空 = CORS 拒所有跨 origin 请求（同源 / 无 Origin 头继续放行）。
func buildC2TestRouter(t *testing.T, pool *pgxpool.Pool, allowedOrigins ...string) http.Handler {
	t.Helper()

	authSvc := newTestAuthService(t, pool)
	rbacSvc, err := services.NewRBACService(services.RBACServiceDeps{Pool: pool})
	require.NoError(t, err)
	userSvc, err := services.NewUserService(services.UserServiceDeps{Pool: pool, BcryptCost: bcrypt.MinCost})
	require.NoError(t, err)
	projectSvc, err := services.NewProjectService(services.ProjectServiceDeps{Pool: pool})
	require.NoError(t, err)
	fileSvc, err := services.NewFileService(services.FileServiceDeps{
		Pool:         pool,
		StoragePath:  t.TempDir(),
		MaxSizeBytes: 1024 * 1024,
	})
	require.NoError(t, err)
	wsHub := services.NewWSHub()
	notifSvc, err := services.NewNotificationService(services.NotificationServiceDeps{Pool: pool, Hub: wsHub})
	require.NoError(t, err)
	cipher, err := services.NewCipherService(pool, []byte(testutil.TestCipherKey))
	require.NoError(t, err)
	auditSvc, err := services.NewAuditService(pool)
	require.NoError(t, err)
	feedbackSvc, err := services.NewFeedbackService(services.FeedbackServiceDeps{Pool: pool, NotificationService: notifSvc, Cipher: cipher})
	require.NoError(t, err)
	quoteSvc, err := services.NewQuoteService(pool)
	require.NoError(t, err)
	paymentSvc, err := services.NewPaymentService(services.PaymentServiceDeps{Pool: pool, NotificationService: notifSvc, Cipher: cipher})
	require.NoError(t, err)

	router, err := NewRouter(RouterDeps{
		Pool:                pool,
		AuthService:         authSvc,
		RBACService:         rbacSvc,
		UserService:         userSvc,
		ProjectService:      projectSvc,
		FileService:         fileSvc,
		FeedbackService:     feedbackSvc,
		QuoteService:        quoteSvc,
		PaymentService:      paymentSvc,
		NotificationService: notifSvc,
		WSHub:               wsHub,
		EventHub:            services.NewEventHub(),
		AllowedOrigins:      allowedOrigins,
		Cipher:              cipher,
		Audit:               auditSvc,
	})
	require.NoError(t, err)
	return router
}

// reseedAdminPassword 把 0001 init 的 admin（其 password_hash 已被 0021 置 NULL）
// 重新设置成传入的明文密码。仅供测试 setup 用。
//
// 业务背景：finding #18 / 0021 migration 把默认 admin/admin123 hash 置 NULL，
// 所有依赖"用 admin 登录拿 token"的测试都需要先通过本 helper 重置。
func reseedAdminPassword(t *testing.T, ctx context.Context, pool *pgxpool.Pool, password string) {
	t.Helper()
	hash, err := auth.HashPassword(password, bcrypt.MinCost)
	require.NoError(t, err)
	tag, err := pool.Exec(ctx, `
		UPDATE users SET password_hash = $1, updated_at = NOW()
		WHERE username = 'admin'
	`, hash)
	require.NoError(t, err)
	require.Equal(t, int64(1), tag.RowsAffected(), "admin 行未命中（0001 init 应已 seed）")
}

// ============================================================
// finding #13：CORS 白名单回归测试
//
// 旧版 CORS handler 把任意 Origin 反射回 ACAO + ACA-Credentials:true，
// 等效拆掉 CSRF 屏障。新版按 AllowedOrigins 精确白名单匹配，非白名单不发头。
//
// 用例覆盖 4 类场景：
//  1. 白名单内 origin → 发完整 CORS 头
//  2. 非白名单 origin（含前缀绕过 evil.com.localhost / localhost.evil.com）→ 不发头
//  3. 无 Origin 头（同源 / curl）→ 不发头但放行
//  4. preflight OPTIONS → 仅白名单 origin 走 204；其余落到 ogen 自处理
//
// 不依赖 DB —— 直接装一个最小 router 跑 CORS middleware。
// ============================================================

func TestCORS_AcceptsWhitelistOrigin(t *testing.T) {
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()
	router := buildC2TestRouter(t, tdb.Pool, "tauri://localhost", "http://localhost:1420")

	req := httptest.NewRequest(http.MethodOptions, "/api/auth/login", nil)
	req.Header.Set("Origin", "tauri://localhost")
	req.Header.Set("Access-Control-Request-Method", "POST")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, "tauri://localhost", rec.Header().Get("Access-Control-Allow-Origin"))
	assert.Equal(t, "true", rec.Header().Get("Access-Control-Allow-Credentials"))
	assert.Equal(t, "Origin", rec.Header().Get("Vary"))
}

func TestCORS_RejectsNonWhitelistOrigin(t *testing.T) {
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()
	router := buildC2TestRouter(t, tdb.Pool, "tauri://localhost", "http://localhost:1420")

	req := httptest.NewRequest(http.MethodOptions, "/api/auth/login", nil)
	req.Header.Set("Origin", "https://evil.com")
	req.Header.Set("Access-Control-Request-Method", "POST")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Empty(t, rec.Header().Get("Access-Control-Allow-Origin"),
		"非白名单 origin 必须不下发 ACAO 头让浏览器自行拒绝")
	assert.Empty(t, rec.Header().Get("Access-Control-Allow-Credentials"),
		"非白名单 origin 必须不下发 ACA-Credentials 头")
	assert.Equal(t, "Origin", rec.Header().Get("Vary"),
		"Vary: Origin 必须始终下发让中间缓存按 origin 区分响应")
}

func TestCORS_RejectsPrefixBypassAttempt(t *testing.T) {
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()
	router := buildC2TestRouter(t, tdb.Pool, "http://localhost:1420")

	// 经典前缀绕过：localhost.evil.com / evil.com.localhost 不应被白名单认成 localhost
	for _, evilOrigin := range []string{
		"http://localhost.evil.com",
		"http://localhost:1420.evil.com",
		"http://evil.com/localhost:1420",
	} {
		t.Run(evilOrigin, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodOptions, "/api/auth/login", nil)
			req.Header.Set("Origin", evilOrigin)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			assert.Empty(t, rec.Header().Get("Access-Control-Allow-Origin"),
				"前缀绕过尝试 %q 必须被拒", evilOrigin)
		})
	}
}

func TestCORS_NoOriginHeaderPassesThrough(t *testing.T) {
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()
	router := buildC2TestRouter(t, tdb.Pool, "tauri://localhost")

	// 同源 / curl / Tauri reqwest 不带 Origin 头 → 不写 CORS 头但请求继续
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Empty(t, rec.Header().Get("Access-Control-Allow-Origin"))
	assert.Empty(t, rec.Header().Get("Access-Control-Allow-Credentials"))
}

func TestCORS_EmptyAllowedOriginsRejectsAll(t *testing.T) {
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()
	// 不传 allowedOrigins → router 内 allowedOrigins map 为空
	router := buildC2TestRouter(t, tdb.Pool)

	req := httptest.NewRequest(http.MethodOptions, "/api/auth/login", nil)
	req.Header.Set("Origin", "tauri://localhost")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Empty(t, rec.Header().Get("Access-Control-Allow-Origin"),
		"空白名单必须拒所有跨 origin 请求")
}

// ============================================================
// finding #14：HTTP body 大小限制路由集成回归测试
//
// 验证：
//  1. /api/auth/login body 超 1MB 默认 → 413
//  2. /api/auth/login body 1KB 正常 → 处理（这里期望 401 因为 body 是垃圾 JSON
//     但走到了 handler 即说明 body limit 没拦住）
//  3. /api/files (multipart) body 在 fileBodyLimit 之内不被全局 1MB 拦住
// ============================================================

func TestBodyLimit_RouteAuthLoginRejectsLargeBody(t *testing.T) {
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()
	router := buildC2TestRouter(t, tdb.Pool, "tauri://localhost")

	// 构造 2MB 垃圾 JSON：超 1MB 默认上限
	hugeBody := bytes.Repeat([]byte("a"), 2*1024*1024)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(hugeBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusRequestEntityTooLarge, rec.Code,
		"超 1MB body 必须返 413；实际 status=%d body=%s", rec.Code, rec.Body.String())

	var envelope struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&envelope))
	assert.Equal(t, "request_body_too_large", envelope.Error.Code)
}

func TestBodyLimit_RouteAuthLoginAcceptsSmallBody(t *testing.T) {
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()
	router := buildC2TestRouter(t, tdb.Pool, "tauri://localhost")

	// 合法登录请求 body：~50 字节，远小于 1MB
	smallBody := []byte(`{"username":"admin","password":"wrong-password-x"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(smallBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// 期望非 413：要么 200/201（不太可能因为密码错），要么 401/422 业务错误
	// 关键是 BodyLimit 没拦住请求让它走到 handler
	assert.NotEqual(t, http.StatusRequestEntityTooLarge, rec.Code,
		"小 body 必须不被 BodyLimit 拦截；实际 status=%d", rec.Code)
}

// loginAndGetAccess 走 POST /api/auth/login 拿 access token；调用方负责传入 username/password。
func loginAndGetAccess(t *testing.T, ts *httptest.Server, username, password string) string {
	t.Helper()
	body, err := json.Marshal(map[string]string{
		"username": username,
		"password": password,
	})
	require.NoError(t, err)

	req, err := http.NewRequest(http.MethodPost, ts.URL+"/api/auth/login", bytes.NewReader(body))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")

	resp, err := ts.Client().Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusOK, resp.StatusCode, "登录必须 200")

	// 响应是 envelope { "data": { "accessToken": ... } }
	var loginResp struct {
		Data struct {
			AccessToken  string `json:"accessToken"`
			RefreshToken string `json:"refreshToken"`
		} `json:"data"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&loginResp))
	require.NotEmpty(t, loginResp.Data.AccessToken)
	return loginResp.Data.AccessToken
}
