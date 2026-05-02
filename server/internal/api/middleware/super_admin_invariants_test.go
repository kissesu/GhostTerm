/*
@file super_admin_invariants_test.go
@description SuperAdminInvariants 中间件测试 —— 4 个 plan §0.5 拦截场景 + 4 个对照 pass-through 用例。

四个拦截规则：
  1. UserCreateWithRoleID1Rejected         — POST /api/users body.roleId=1 → 422
  2. RolePermissionsWriteRoleID1Rejected   — PATCH /api/roles/1/permissions → 422
  3. UserPermissionOverrideTargetingSuperAdminRejected — PATCH /api/users/1/permission-overrides → 422
  4. RoleDeleteRoleID1Rejected             — DELETE /api/roles/1 → 422

对照（同一测试函数内）：roleId=2 / 普通用户 → next.ServeHTTP 被调用、无 422。

设计取舍：
  - 直接 import services 包：用 testutil.StartPostgres + 0007 已 seed 的 admin (id=1 role=1) 即可，
    不需要 mock；避免 mock 与真实 SQL schema drift
  - 用 httptest.NewRecorder + http.NewRequest 直接驱动 middleware；不用 chi router 模拟
    （middleware 只读 r.URL.Path + body，与 router 解耦）
  - 拦截后必须验证 next handler 没被调用：用 nextCalled bool 闭包断言

@author Atlas.oi
@date 2026-05-02
*/

package middleware_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"github.com/ghostterm/progress-server/internal/api/middleware"
	"github.com/ghostterm/progress-server/internal/auth"
	"github.com/ghostterm/progress-server/internal/testutil"
)

// ============================================================
// 共享 helper
// ============================================================

// setupMW 启 postgres 容器（已含 0001-0007 全部迁移），返回 SuperAdminInvariants 实例 + cleanup。
//
// 业务背景：0001 seed 了 admin(id=1, role_id=1)，即超管；
// 0007 seed 了角色权限关系；本中间件依赖的是 users.role_id 查询，0001 已足够。
func setupMW(t *testing.T) (*middleware.SuperAdminInvariants, *pgxpool.Pool, func()) {
	t.Helper()
	pool, cleanup := testutil.StartPostgres(t)
	mw := middleware.NewSuperAdminInvariants(pool)
	return mw, pool, cleanup
}

// seedNonSuperUser 插一个 role_id=2 (dev) 用户，返回 id —— 用作"对照组"目标。
func seedNonSuperUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, username string) int64 {
	t.Helper()
	hash, err := auth.HashPassword("password", bcrypt.MinCost)
	require.NoError(t, err)
	var id int64
	err = pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, display_name, role_id, is_active)
		VALUES ($1, $2, 'Dev User', 2, TRUE)
		RETURNING id
	`, username, hash).Scan(&id)
	require.NoError(t, err)
	return id
}

// nextSpy 返回一个 http.Handler + bool 指针；指针为 true 表示 next 被调用。
//
// 业务背景：拦截判定的核心断言不是 status code 而是"下游 handler 没被触达"，
// 否则即使 422 但 next 已写入了部分响应也算泄露。
func nextSpy() (http.Handler, *bool) {
	called := false
	h := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})
	return h, &called
}

// runMW 用给定 method/path/body 跑一次中间件，返回 ResponseRecorder + nextCalled。
func runMW(t *testing.T, mw *middleware.SuperAdminInvariants, method, path string, body []byte) (*httptest.ResponseRecorder, bool, []byte) {
	t.Helper()
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req := httptest.NewRequest(method, path, rd)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	next, called := nextSpy()
	mw.Handler(next).ServeHTTP(rec, req)
	return rec, *called, rec.Body.Bytes()
}

// assertSuperAdminImmutable 校验响应是 422 + code=super_admin_immutable。
func assertSuperAdminImmutable(t *testing.T, rec *httptest.ResponseRecorder, body []byte, called bool) {
	t.Helper()
	assert.False(t, called, "next handler MUST NOT be called when middleware rejects")
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code, "expected 422")
	var env map[string]any
	require.NoError(t, json.Unmarshal(body, &env), "response body must be JSON envelope")
	errObj, ok := env["error"].(map[string]any)
	require.True(t, ok, "envelope must have .error object")
	assert.Equal(t, "super_admin_immutable", errObj["code"], "code must be super_admin_immutable")
	msg, _ := errObj["message"].(string)
	assert.NotEmpty(t, msg, "message must be non-empty")
}

// ============================================================
// 测试用例 1：POST /api/users body.roleId=1 → 拦截
// ============================================================

func TestSuperAdminInvariants_UserCreateWithRoleID1Rejected(t *testing.T) {
	mw, _, cleanup := setupMW(t)
	defer cleanup()

	// 拦截分支：roleId=1（创建超管）
	body := []byte(`{"username":"newsuper","password":"password","roleId":1}`)
	rec, called, respBody := runMW(t, mw, http.MethodPost, "/api/users", body)
	assertSuperAdminImmutable(t, rec, respBody, called)

	// 对照分支：roleId=2（创建普通用户）→ 应 pass-through
	body2 := []byte(`{"username":"newdev","password":"password","roleId":2}`)
	rec2, called2, _ := runMW(t, mw, http.MethodPost, "/api/users", body2)
	assert.True(t, called2, "next must be called for non-super create")
	assert.Equal(t, http.StatusOK, rec2.Code)
}

// ============================================================
// 测试用例 2：PATCH /api/roles/1/permissions → 拦截
// ============================================================

func TestSuperAdminInvariants_RolePermissionsWriteRoleID1Rejected(t *testing.T) {
	mw, _, cleanup := setupMW(t)
	defer cleanup()

	// 拦截分支：path id=1（修改超管角色权限）
	body := []byte(`{"permissionIds":[1,2,3]}`)
	rec, called, respBody := runMW(t, mw, http.MethodPatch, "/api/roles/1/permissions", body)
	assertSuperAdminImmutable(t, rec, respBody, called)

	// 对照分支：path id=2（修改 dev 角色权限）→ pass-through
	rec2, called2, _ := runMW(t, mw, http.MethodPatch, "/api/roles/2/permissions", body)
	assert.True(t, called2, "next must be called for non-super role")
	assert.Equal(t, http.StatusOK, rec2.Code)
}

// ============================================================
// 测试用例 3：PATCH /api/users/{superID}/permission-overrides → 拦截
// ============================================================

func TestSuperAdminInvariants_UserPermissionOverrideTargetingSuperAdminRejected(t *testing.T) {
	mw, pool, cleanup := setupMW(t)
	defer cleanup()

	ctx := context.Background()

	// Sanity check：0001 seed 假设——id=1 用户必须是 super_admin (role_id=1)。
	// 任何后续 migration 误改 seed 都会让本测试随便绿，必须先 fail-fast 暴露 drift。
	var seedRoleID int64
	require.NoError(t, pool.QueryRow(ctx, `SELECT role_id FROM users WHERE id = 1`).Scan(&seedRoleID))
	require.Equal(t, int64(1), seedRoleID, "0001 seed assumption violated: user id=1 must be super_admin")

	// 0001 已 seed admin(id=1, role_id=1)；同时 seed 一个 dev 作为对照
	devID := seedNonSuperUser(t, ctx, pool, "dev_for_override_test")

	// 拦截分支：target user id=1（admin/超管）
	body := []byte(`{"overrides":[{"permissionId":1,"effect":"deny"}]}`)
	rec, called, respBody := runMW(t, mw, http.MethodPatch, "/api/users/1/permission-overrides", body)
	assertSuperAdminImmutable(t, rec, respBody, called)

	// 对照分支：target user 是 dev → pass-through
	devPath := "/api/users/" + strconv.FormatInt(devID, 10) + "/permission-overrides"
	rec2, called2, _ := runMW(t, mw, http.MethodPatch, devPath, body)
	assert.True(t, called2, "next must be called for non-super target")
	assert.Equal(t, http.StatusOK, rec2.Code)
}

// ============================================================
// 测试用例 4：DELETE /api/roles/1 → 拦截
// ============================================================

func TestSuperAdminInvariants_RoleDeleteRoleID1Rejected(t *testing.T) {
	mw, _, cleanup := setupMW(t)
	defer cleanup()

	// 拦截分支：DELETE 超管角色
	rec, called, respBody := runMW(t, mw, http.MethodDelete, "/api/roles/1", nil)
	assertSuperAdminImmutable(t, rec, respBody, called)

	// 对照分支：DELETE 普通角色 → pass-through
	rec2, called2, _ := runMW(t, mw, http.MethodDelete, "/api/roles/2", nil)
	assert.True(t, called2, "next must be called for non-super role delete")
	assert.Equal(t, http.StatusOK, rec2.Code)
}

// ============================================================
// 辅助：附加 sanity 检查 —— 中间件不破坏 body（下游能读到完整 JSON）
// ============================================================

// TestSuperAdminInvariants_BodyPreservedForDownstream 保护：peek body 后必须 reset，
// 否则下游 handler 读到空流会 400/500。
//
// 业务背景：除了字节级 reset，还要确认 raw body 仍能被 json.Decode 解析出原字段——
// MaxBytesReader/NopCloser 包装链一旦写错，字节相同但 stream 状态可能让 Decoder 直接报错。
func TestSuperAdminInvariants_BodyPreservedForDownstream(t *testing.T) {
	mw, _, cleanup := setupMW(t)
	defer cleanup()

	original := `{"username":"newdev","password":"password","roleId":2}`
	var capturedBody string
	var decoded map[string]any
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		buf, _ := io.ReadAll(r.Body)
		capturedBody = string(buf)
		// 真实下游 handler 走的是 json.Decoder 路径；这里同样必须能 decode 出 roleId
		if err := json.Unmarshal(buf, &decoded); err != nil {
			t.Fatalf("downstream couldn't decode body: %v", err)
		}
		w.WriteHeader(http.StatusOK)
	})
	req := httptest.NewRequest(http.MethodPost, "/api/users", strings.NewReader(original))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mw.Handler(h).ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, original, capturedBody, "downstream handler must receive original body intact")
	require.NotNil(t, decoded, "downstream must successfully decode JSON")
	assert.Equal(t, float64(2), decoded["roleId"], "downstream must read original roleId field")
}

// ============================================================
// 测试用例 5：PATCH /api/users/{id} 空 body —— 中间件放行
// ============================================================
//
// 业务背景：PATCH 请求无 body 是合法形态（部分字段更新）；中间件只 peek roleId，
// 没有 roleId 就应该让下游决定 400/422，不能在 middleware 层提前拒绝。
func TestSuperAdminInvariants_PassThroughEmptyBodyOnPatch(t *testing.T) {
	mw, _, cleanup := setupMW(t)
	defer cleanup()

	rec, called, _ := runMW(t, mw, http.MethodPatch, "/api/users/2", nil)
	assert.True(t, called, "next must be called when PATCH body is empty (no roleId to peek)")
	assert.Equal(t, http.StatusOK, rec.Code)
}

// ============================================================
// 测试用例 6：PATCH /api/users/{id} 畸形 JSON —— 中间件放行让下游回 400
// ============================================================
//
// 业务背景：JSON 解析失败不属于"违反超管不可改"；让真正的 OAS validator 回 400 比中间件越权更对。
func TestSuperAdminInvariants_PassThroughMalformedJSON(t *testing.T) {
	mw, _, cleanup := setupMW(t)
	defer cleanup()

	rec, called, _ := runMW(t, mw, http.MethodPatch, "/api/users/2", []byte(`{not json`))
	assert.True(t, called, "next must be called when body is malformed (let downstream return 400)")
	assert.Equal(t, http.StatusOK, rec.Code)
}

// ============================================================
// 测试用例 7：PATCH /api/users/2/ trailing slash —— 拦截仍生效
// ============================================================
//
// 业务背景：strings.HasPrefix/HasSuffix 是字面比较；不归一化 trailing slash 即可绕过整套规则。
// 本用例固定路径以 "/" 结尾，验证 Handler 顶部的 TrimRight 真的工作。
func TestSuperAdminInvariants_TrailingSlashStillTriggers(t *testing.T) {
	mw, _, cleanup := setupMW(t)
	defer cleanup()

	body := []byte(`{"roleId":1}`)
	rec, called, respBody := runMW(t, mw, http.MethodPatch, "/api/users/2/", body)
	assertSuperAdminImmutable(t, rec, respBody, called)
}

// ============================================================
// 测试用例 8：DELETE /api/roles/1/ trailing slash —— 拦截仍生效
// ============================================================
func TestSuperAdminInvariants_TrailingSlashRoleDelete(t *testing.T) {
	mw, _, cleanup := setupMW(t)
	defer cleanup()

	rec, called, respBody := runMW(t, mw, http.MethodDelete, "/api/roles/1/", nil)
	assertSuperAdminImmutable(t, rec, respBody, called)
}

