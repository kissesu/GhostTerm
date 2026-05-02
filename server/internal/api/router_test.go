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
	// admin 用户已由 0001 migration 预置；用 admin/admin123 登录拿 access token
	const adminUsername = "admin"
	const adminPassword = "admin123"
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
	access, _, _, err := authSvc.Login(ctx, "admin", "admin123")
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
func buildC2TestRouter(t *testing.T, pool *pgxpool.Pool) http.Handler {
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
	feedbackSvc, err := services.NewFeedbackService(services.FeedbackServiceDeps{Pool: pool, NotificationService: notifSvc})
	require.NoError(t, err)
	quoteSvc, err := services.NewQuoteService(pool)
	require.NoError(t, err)
	paymentSvc, err := services.NewPaymentService(services.PaymentServiceDeps{Pool: pool, NotificationService: notifSvc})
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
	})
	require.NoError(t, err)
	return router
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
