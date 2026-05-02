/*
@file rbac_test.go
@description LoadEffectivePermissions + RequirePermission + MatchPermission 单测。

测试设计：
  - 用 fake EffectivePermissionsService（不打 DB）覆盖 happy/error path
  - RequirePermission 测试用 WithEffectivePermissions 直接构造 ctx，绕过中间件
  - MatchPermission 单测覆盖四档优先级 + 退化 case（空、单段、空段）

共 6 个 RBAC test case：
  1. RequirePermission_WithDirectGrant       — 用户有精确 code → 200
  2. RequirePermission_DeniesWithoutGrant    — 用户没该 code → 403
  3. RequirePermission_SuperAdminBypass      — *:* 哨兵任意 code 全 200
  4. RequirePermission_WildcardThreeTier     — progress:*:* 命中 progress:project:list → 200
  5. RequirePermission_EmptyContext          — ctx 无 perms → 403（防御）
  6. LoadEffectivePermissions_DBError        — eff.Compute err → 503

外加 MatchPermission 表驱动测试覆盖所有匹配档位。

@author Atlas.oi
@date 2026-05-02
*/

package middleware_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ghostterm/progress-server/internal/api/middleware"
	"github.com/ghostterm/progress-server/internal/services"
)

// ============================================================
// 测试用 fake EffectivePermissionsService
// ============================================================

// fakeEffSvc 是 EffectivePermissionsService 的内存桩。
//
// 业务背景：本测试关注 middleware 行为；真实 service 由 effective_permissions_service_test
// 用 dockertest 覆盖，不再重复。fake 只保留 Compute 一个方法即可（接口仅一个方法）。
type fakeEffSvc struct {
	perms map[int64][]string
	err   error
}

func (f *fakeEffSvc) Compute(_ context.Context, userID int64) ([]string, error) {
	if f.err != nil {
		return nil, f.err
	}
	if p, ok := f.perms[userID]; ok {
		return p, nil
	}
	return []string{}, nil
}

// makeReqWithAuth 构造带 AuthContext 的 request；req body 空。
func makeReqWithAuth(userID, roleID int64) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/api/test", nil)
	ctx := middleware.WithAuthContext(r.Context(), services.AuthContext{
		UserID: userID,
		RoleID: roleID,
	})
	return r.WithContext(ctx)
}

// makeReqWithPerms 构造已注入 perms 的 request（绕过 LoadEffectivePermissions）。
func makeReqWithPerms(perms []string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/api/test", nil)
	ctx := middleware.WithEffectivePermissions(r.Context(), perms)
	return r.WithContext(ctx)
}

// noopHandler 是 next handler；记录是否被调用。
func noopHandler(called *bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		*called = true
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
}

// ============================================================
// RequirePermission 用例
// ============================================================

// 1. 直接 grant 精确 code → 200
func TestRBAC_RequirePermission_WithDirectGrant(t *testing.T) {
	called := false
	mw := middleware.RequirePermission("permissions:role:manage")
	r := makeReqWithPerms([]string{"permissions:role:manage", "feedback:create:own"})
	w := httptest.NewRecorder()
	mw(noopHandler(&called)).ServeHTTP(w, r)

	assert.True(t, called, "next handler should be called")
	assert.Equal(t, http.StatusOK, w.Code)
}

// 2. 没有 grant → 403
func TestRBAC_RequirePermission_DeniesWithoutGrant(t *testing.T) {
	called := false
	mw := middleware.RequirePermission("permissions:role:manage")
	// dev 用户：仅有 feedback 权限，无权限管理
	r := makeReqWithPerms([]string{"feedback:create:own", "project:read:own"})
	w := httptest.NewRecorder()
	mw(noopHandler(&called)).ServeHTTP(w, r)

	assert.False(t, called, "next handler must NOT be called")
	assert.Equal(t, http.StatusForbidden, w.Code)
	assert.Contains(t, w.Body.String(), "permission_denied")
}

// 3. super_admin *:* 哨兵 → 任何 code 都放行
func TestRBAC_RequirePermission_SuperAdminBypass(t *testing.T) {
	cases := []string{
		"permissions:role:manage",
		"permissions:user_override:manage",
		"feedback:create:own",
		"project:delete:any", // 注意：现实中可能不存在的 code，super_admin 也应放行
	}
	for _, code := range cases {
		t.Run(code, func(t *testing.T) {
			called := false
			mw := middleware.RequirePermission(code)
			r := makeReqWithPerms([]string{"*:*"})
			w := httptest.NewRecorder()
			mw(noopHandler(&called)).ServeHTTP(w, r)

			assert.True(t, called, "super_admin must pass any code")
			assert.Equal(t, http.StatusOK, w.Code)
		})
	}
}

// 4. resource:*:* 全资源通配 → 命中 resource:action:scope
func TestRBAC_RequirePermission_WildcardThreeTier(t *testing.T) {
	type sub struct {
		name  string
		perms []string
		code  string
		want  int // expected http code
	}
	subs := []sub{
		{
			name:  "resource:*:* matches resource:project:list",
			perms: []string{"progress:*:*"},
			code:  "progress:project:list",
			want:  http.StatusOK,
		},
		{
			name:  "resource:action:* matches resource:action:any_scope",
			perms: []string{"progress:project:*"},
			code:  "progress:project:list",
			want:  http.StatusOK,
		},
		{
			name:  "resource mismatch even with *:*",
			perms: []string{"feedback:*:*"},
			code:  "progress:project:list",
			want:  http.StatusForbidden,
		},
		{
			name:  "action mismatch with resource:action:*",
			perms: []string{"progress:project:*"},
			code:  "progress:file:upload",
			want:  http.StatusForbidden,
		},
	}
	for _, s := range subs {
		t.Run(s.name, func(t *testing.T) {
			called := false
			mw := middleware.RequirePermission(s.code)
			r := makeReqWithPerms(s.perms)
			w := httptest.NewRecorder()
			mw(noopHandler(&called)).ServeHTTP(w, r)

			assert.Equal(t, s.want, w.Code)
			assert.Equal(t, s.want == http.StatusOK, called)
		})
	}
}

// 5. ctx 中无 perms（未挂 LoadEffectivePermissions） → 403
//
// 防御场景：保证"忘记挂中间件"不会被默默放行；fail-closed 原则。
func TestRBAC_RequirePermission_EmptyContext(t *testing.T) {
	called := false
	mw := middleware.RequirePermission("permissions:role:manage")
	// 直接构 request，不调 WithEffectivePermissions
	r := httptest.NewRequest(http.MethodGet, "/api/test", nil)
	w := httptest.NewRecorder()
	mw(noopHandler(&called)).ServeHTTP(w, r)

	assert.False(t, called)
	assert.Equal(t, http.StatusForbidden, w.Code)
	assert.Contains(t, w.Body.String(), "permission_denied")
}

// ============================================================
// LoadEffectivePermissions 用例
// ============================================================

// 6. service.Compute 失败 → 503 + 不放行
func TestRBAC_LoadEffectivePermissions_DBError(t *testing.T) {
	called := false
	eff := &fakeEffSvc{err: errors.New("fake db down")}
	mw := middleware.LoadEffectivePermissions(eff)
	r := makeReqWithAuth(2, 2) // dev user
	w := httptest.NewRecorder()
	mw(noopHandler(&called)).ServeHTTP(w, r)

	assert.False(t, called, "must NOT call downstream when perms load fails")
	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
	assert.Contains(t, w.Body.String(), "service_unavailable")
}

// LoadEffectivePermissions 成功 → ctx 有 perms 且 next 被调
func TestRBAC_LoadEffectivePermissions_HappyPath(t *testing.T) {
	eff := &fakeEffSvc{
		perms: map[int64][]string{
			42: {"feedback:create:own", "project:read:own"},
		},
	}
	mw := middleware.LoadEffectivePermissions(eff)
	r := makeReqWithAuth(42, 2)

	var caughtPerms []string
	var caughtOK bool
	next := http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		caughtPerms, caughtOK = middleware.EffectivePermsFrom(req.Context())
		w.WriteHeader(http.StatusOK)
	})
	w := httptest.NewRecorder()
	mw(next).ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code)
	require.True(t, caughtOK, "ctx must contain perms")
	assert.Equal(t, []string{"feedback:create:own", "project:read:own"}, caughtPerms)
}

// LoadEffectivePermissions 没 AuthContext 时透传（非阻塞）
//
// 业务背景：该中间件挂在路由全局时，未鉴权请求（如 /healthz、/api/auth/login）
// 也会经过；不应在此处拦截，留给 ogen SecurityHandler 决定。
func TestRBAC_LoadEffectivePermissions_NoAuthPassThrough(t *testing.T) {
	called := false
	eff := &fakeEffSvc{} // 不该被调
	mw := middleware.LoadEffectivePermissions(eff)
	r := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	w := httptest.NewRecorder()
	mw(noopHandler(&called)).ServeHTTP(w, r)

	assert.True(t, called, "no AuthContext should pass through, not block")
	assert.Equal(t, http.StatusOK, w.Code)
}

// ============================================================
// MatchPermission 表驱动用例
// ============================================================

// MatchPermission 覆盖四档命中 + 异常输入。
//
// 业务背景：handler 内 checkPerm 直接调本函数；任何 bug 影响全权限模块，必须密集覆盖。
func TestRBAC_MatchPermission(t *testing.T) {
	type tc struct {
		name  string
		perms []string
		want  string
		ok    bool
	}
	cases := []tc{
		// 命中：四档优先级
		{name: "exact_match", perms: []string{"a:b:c"}, want: "a:b:c", ok: true},
		{name: "action_wildcard_scope", perms: []string{"a:b:*"}, want: "a:b:c", ok: true},
		{name: "resource_wildcard_full", perms: []string{"a:*:*"}, want: "a:b:c", ok: true},
		{name: "super_admin_global", perms: []string{"*:*"}, want: "a:b:c", ok: true},
		{name: "super_admin_global_with_others", perms: []string{"*:*", "x:y:z"}, want: "anything:goes:here", ok: true},

		// 不命中
		{name: "no_match_at_all", perms: []string{"x:y:z"}, want: "a:b:c", ok: false},
		{name: "wrong_resource_with_action_scope", perms: []string{"x:b:*"}, want: "a:b:c", ok: false},
		{name: "wrong_action_with_resource_full", perms: []string{"a:x:*"}, want: "a:b:c", ok: false},
		{name: "empty_perms", perms: []string{}, want: "a:b:c", ok: false},
		{name: "nil_perms", perms: nil, want: "a:b:c", ok: false},

		// 退化输入：want 非 3 段
		{name: "want_one_segment", perms: []string{"*:*"}, want: "broken", ok: false},
		{name: "want_two_segments", perms: []string{"*:*"}, want: "a:b", ok: false},
		{name: "want_four_segments", perms: []string{"*:*"}, want: "a:b:c:d", ok: false},
		{name: "want_empty_segment", perms: []string{"*:*"}, want: "a::c", ok: false},
		{name: "want_empty_string", perms: []string{"*:*"}, want: "", ok: false},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := middleware.MatchPermission(c.perms, c.want)
			assert.Equal(t, c.ok, got)
		})
	}
}
