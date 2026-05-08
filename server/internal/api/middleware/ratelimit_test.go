/*
@file ratelimit_test.go
@description 登录与 refresh 速率限制 middleware 单测。
             覆盖 IP 维度封顶、username 维度封顶、不同 IP 独立计数、refresh 仅 IP 维度
             4 类核心场景，并验证 LoginMiddleware 拦截后 r.Body 仍可被 next handler 读取。
@author Atlas.oi
@date 2026-05-08
*/

package middleware_test

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/ghostterm/progress-server/internal/api/middleware"
)

// TestLoginRateLimit_BlocksAfterIPLimit 验证：单 IP 触达 LoginPerMinPerIP 后第 N+1 次拒。
//
// 关键断言：
//  1. 前 5 次成功 + r.Body 仍可读（middleware 必须 restore body）
//  2. 第 6 次返回 429 + Retry-After 非空
func TestLoginRateLimit_BlocksAfterIPLimit(t *testing.T) {
	rl := middleware.NewLoginRateLimiter(middleware.RateLimitConfig{
		LoginPerMinPerIP:   5,
		LoginPerMinPerUser: 100, // user 维度宽松，单测 IP
		RefreshPerMinPerIP: 30,
		TTL:                time.Minute,
	})
	defer rl.Stop()

	handler := rl.LoginMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 验证 r.Body 仍可读（middleware peek 后必须 restore body 否则 ogen decode 拿空数据）
		body, _ := io.ReadAll(r.Body)
		require.NotEmpty(t, body, "middleware 必须 restore r.Body 让 next handler 可读")
		w.WriteHeader(http.StatusOK)
	}))

	// 5 次成功
	for i := 0; i < 5; i++ {
		req := httptest.NewRequest("POST", "/", strings.NewReader(`{"username":"alice","password":"x"}`))
		req.RemoteAddr = "1.2.3.4:5678"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		require.Equal(t, http.StatusOK, rec.Code, "request %d should pass", i+1)
	}
	// 第 6 次拒
	req := httptest.NewRequest("POST", "/", strings.NewReader(`{"username":"alice","password":"x"}`))
	req.RemoteAddr = "1.2.3.4:5678"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	require.Equal(t, http.StatusTooManyRequests, rec.Code)
	require.NotEmpty(t, rec.Header().Get("Retry-After"))
}

// TestLoginRateLimit_BlocksAfterUsernameLimit 验证：同 username 在不同 IP 也会被 user 维度封顶。
//
// 业务背景：botnet 用 N 个 IP 各 1 次撞同一个 admin 账号。
// 仅 IP 维度无法防御此场景；username 维度补漏。
func TestLoginRateLimit_BlocksAfterUsernameLimit(t *testing.T) {
	rl := middleware.NewLoginRateLimiter(middleware.RateLimitConfig{
		LoginPerMinPerIP:   100, // IP 宽松
		LoginPerMinPerUser: 3,   // user 严
		RefreshPerMinPerIP: 30,
		TTL:                time.Minute,
	})
	defer rl.Stop()

	handler := rl.LoginMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// 同 username 3 次成功（不同 IP）
	for i := 0; i < 3; i++ {
		req := httptest.NewRequest("POST", "/", strings.NewReader(`{"username":"victim","password":"x"}`))
		req.RemoteAddr = fmt.Sprintf("1.1.1.%d:80", i+1)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		require.Equal(t, http.StatusOK, rec.Code)
	}
	// 第 4 次（不同 IP 但同 username）拒
	req := httptest.NewRequest("POST", "/", strings.NewReader(`{"username":"victim","password":"x"}`))
	req.RemoteAddr = "9.9.9.9:80"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	require.Equal(t, http.StatusTooManyRequests, rec.Code)
}

// TestLoginRateLimit_DifferentIPsIndependent 验证：IP1 用尽不影响 IP2。
//
// 桶按 key 隔离，避免一个 IP 被滥用拖累其他用户。
func TestLoginRateLimit_DifferentIPsIndependent(t *testing.T) {
	rl := middleware.NewLoginRateLimiter(middleware.RateLimitConfig{
		LoginPerMinPerIP:   2,
		LoginPerMinPerUser: 100,
		RefreshPerMinPerIP: 30,
		TTL:                time.Minute,
	})
	defer rl.Stop()

	handler := rl.LoginMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest("POST", "/", strings.NewReader(`{"username":"a"}`))
		req.RemoteAddr = "1.1.1.1:80"
		handler.ServeHTTP(httptest.NewRecorder(), req)
	}
	req := httptest.NewRequest("POST", "/", strings.NewReader(`{"username":"a"}`))
	req.RemoteAddr = "1.1.1.1:80"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	require.Equal(t, http.StatusTooManyRequests, rec.Code)

	// IP2 仍可通过
	req2 := httptest.NewRequest("POST", "/", strings.NewReader(`{"username":"a"}`))
	req2.RemoteAddr = "2.2.2.2:80"
	rec2 := httptest.NewRecorder()
	handler.ServeHTTP(rec2, req2)
	require.Equal(t, http.StatusOK, rec2.Code)
}

// TestLoginRateLimit_OversizedBodyReturns413 验证：
// body > 64KiB 直接 413 拒绝（C5 fail-closed），不进 user 桶不进 handler。
//
// 攻击场景（C5）：
//
//	{ "username":"admin", "password":"x", "_padding":"<5KB junk>" }
//
// 原实现 ReadAll(MaxBytes=4KB) 失败 → 返 "" → user 桶跳过 → 走完 handler。
// 多 IP botnet 单账号撞库恢复可行。
//
// 修复后：oversized body 直接返 413 + code "request_body_too_large"，与
// BodyLimit middleware 1MB 拒绝行为一致语义。攻击者每次都被拒，没机会撞库。
func TestLoginRateLimit_OversizedBodyReturns413(t *testing.T) {
	rl := middleware.NewLoginRateLimiter(middleware.RateLimitConfig{
		LoginPerMinPerIP:   1000, // IP 维度故意宽松，避免 IP 桶先拒干扰
		LoginPerMinPerUser: 100,
		RefreshPerMinPerIP: 30,
		TTL:                time.Minute,
	})
	defer rl.Stop()

	handlerCalled := false
	handler := rl.LoginMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		handlerCalled = true
		w.WriteHeader(http.StatusOK)
	}))

	// 构造 100KiB body（> 64KiB cap），触发 oversized 路径
	oversized := strings.Repeat("x", 100*1024)
	req := httptest.NewRequest("POST", "/", strings.NewReader(oversized))
	req.RemoteAddr = "8.8.8.1:80"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	require.Equal(t, http.StatusRequestEntityTooLarge, rec.Code,
		"oversized body 必须直接 413（C5 fail-closed）")
	require.Contains(t, rec.Body.String(), "request_body_too_large",
		"413 envelope 必须用 code request_body_too_large 与 BodyLimit middleware 一致")
	require.False(t, handlerCalled, "oversized 必须不进入 next handler")
}

// TestRefreshRateLimit_OnlyIPDimension 验证：refresh 仅 IP 维度限速，独立桶不与 login 共享。
//
// 业务背景：refresh body 是 token 不含 username，无法做 user 维度；
// 前端 silent refresh 频次较高（access token 临过期触发），故 30/min 比登录 5/min 宽松。
func TestRefreshRateLimit_OnlyIPDimension(t *testing.T) {
	rl := middleware.NewLoginRateLimiter(middleware.RateLimitConfig{
		LoginPerMinPerIP:   5,
		LoginPerMinPerUser: 10,
		RefreshPerMinPerIP: 3,
		TTL:                time.Minute,
	})
	defer rl.Stop()

	handler := rl.RefreshMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	for i := 0; i < 3; i++ {
		req := httptest.NewRequest("POST", "/", strings.NewReader(`{"refresh_token":"abc"}`))
		req.RemoteAddr = "5.5.5.5:80"
		handler.ServeHTTP(httptest.NewRecorder(), req)
	}
	req := httptest.NewRequest("POST", "/", strings.NewReader(`{"refresh_token":"abc"}`))
	req.RemoteAddr = "5.5.5.5:80"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	require.Equal(t, http.StatusTooManyRequests, rec.Code)
}
