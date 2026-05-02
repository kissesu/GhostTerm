/*
@file permissions_test.go
@description PermissionsHandler 适配层测试 —— 8 个用例覆盖 Task 7 6 个端点 + super_admin
             middleware 拦截路径 + token_version bump 副作用：

              1. ListPermissions_OK：admin 拿 23 条 catalog
              2. GetEffectivePermissions_SuperAdmin：返回 ["*:*"] + superAdmin=true
              3. GetEffectivePermissions_Dev：返回 16 条 + superAdmin=false
              4. GetRolePermissions_DevReturns16：dev role grant = 16
              5. UpdateRolePermissions_204：写入成功 + bump 该 role 全部用户 token_version
              6. UpdateRolePermissions_SuperAdminBlocked：HTTP-level 由 middleware 422 拦截
                 （走完整 router 而不只直接调 handler，验证中间件挂载顺序）
              7. GetUserPermissionOverrides_Empty：刚建的 dev 用户 overrides=[]
              8. UpdateUserPermissionOverrides_204：写入 deny 一条 + bump 该用户 token_version

             测试设计：
              - 大部分用例直接调 handler 方法（不经 ogen HTTP 层，与 activity_test.go 一致）；
                handler 是薄适配层，验证 service 输出 → oas 类型映射 + 错误翻译
              - 用例 6 走完整 router（httptest.NewServer + http.Client），验证
                SuperAdminInvariants middleware 实际挂载并能 422 拦截
              - 复用 fixtures.NewTestDB / SeedAdminAuthContext；dev 用户用本地 helper

@author Atlas.oi
@date 2026-05-02
*/

package handlers_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"github.com/ghostterm/progress-server/internal/api"
	"github.com/ghostterm/progress-server/internal/api/handlers"
	"github.com/ghostterm/progress-server/internal/api/middleware"
	"github.com/ghostterm/progress-server/internal/api/oas"
	"github.com/ghostterm/progress-server/internal/auth"
	"github.com/ghostterm/progress-server/internal/services"
	"github.com/ghostterm/progress-server/tests/fixtures"
)

// ============================================================
// 公共 helper：构造 PermissionsHandler + admin AuthContext
// ============================================================

// newPermissionsHandler 装 PermissionsService + EffectivePermissionsService + handler，
// 注入 super_admin AuthContext 到 ctx。
func newPermissionsHandler(t *testing.T) (
	*handlers.PermissionsHandler,
	*fixtures.TestDB,
	services.AuthContext,
	context.Context,
) {
	t.Helper()
	tdb := fixtures.NewTestDB(t)
	t.Cleanup(tdb.Close)

	permsSvc := services.NewPermissionsService(tdb.Pool)
	effSvc := services.NewEffectivePermissionsService(tdb.Pool)
	h := handlers.NewPermissionsHandler(tdb.Pool, permsSvc, effSvc)

	ctx := context.Background()
	ac := fixtures.SeedAdminAuthContext(t, ctx, tdb.Pool)
	ctxWithAuth := middleware.WithAuthContext(ctx, ac)
	return h, tdb, ac, ctxWithAuth
}

// seedDevUser 插一个 role_id=2 普通 dev 用户并返回 id（与 effective_permissions_service_test.go
// 同款本地 helper；复用一份 fixture 名让 dev test 串起来更熟悉）。
func seedDevUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) int64 {
	t.Helper()
	hash, err := auth.HashPassword("password", bcrypt.MinCost)
	require.NoError(t, err)

	uname := fmt.Sprintf("perm-handler-dev-%d", testRandUint())
	var id int64
	err = pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, display_name, role_id, is_active)
		VALUES ($1, $2, 'Handler Dev User', 2, TRUE)
		RETURNING id
	`, uname, hash).Scan(&id)
	require.NoError(t, err)
	return id
}

// testRandUint 借助 nanoTime 给同进程多 NewTestDB 拼出唯一 username。
func testRandUint() uint64 {
	// 保留极简实现：进程级递增计数器够用，不引入 sync 复杂度
	testUniqCounter++
	return testUniqCounter
}

var testUniqCounter uint64

// readTokenVersion 取 users.token_version；用于断言写路径触发 bump。
func readTokenVersion(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID int64) int64 {
	t.Helper()
	var v int64
	err := pool.QueryRow(ctx, `SELECT token_version FROM users WHERE id = $1`, userID).Scan(&v)
	require.NoError(t, err)
	return v
}

// ============================================================
// 1. ListPermissions_OK
// ============================================================

func TestPermissions_ListPermissions_OK(t *testing.T) {
	h, _, _, ctx := newPermissionsHandler(t)

	res, err := h.PermissionsList(ctx)
	require.NoError(t, err)

	listResp, ok := res.(*oas.PermissionListResponse)
	require.True(t, ok, "200 应返回 *PermissionListResponse；实际 %T", res)
	// 0007 migration 种了 23 个权限（nav 3 + progress 14 + users 4 + permissions 2）
	assert.Len(t, listResp.Data, 23, "permissions 字典应有 23 条")

	// 校验 3 段 code 拼装正确：随便挑一条
	for _, p := range listResp.Data {
		assert.Equal(t, p.Resource+":"+p.Action+":"+p.Scope, p.Code,
			"code 必须是 resource:action:scope 拼接")
	}
}

// ============================================================
// 2. GetEffectivePermissions_SuperAdmin
// ============================================================

func TestPermissions_GetEffectivePermissions_SuperAdmin(t *testing.T) {
	h, _, _, ctx := newPermissionsHandler(t)

	res, err := h.MeGetEffectivePermissions(ctx)
	require.NoError(t, err)

	effResp, ok := res.(*oas.EffectivePermissionsResponse)
	require.True(t, ok, "200 应返回 *EffectivePermissionsResponse；实际 %T", res)

	assert.True(t, effResp.SuperAdmin, "super_admin 应返回 superAdmin=true")
	assert.Equal(t, []string{"*:*"}, effResp.Permissions, "super_admin 哨兵应是单元素 [*:*]")
}

// ============================================================
// 3. GetEffectivePermissions_Dev
// ============================================================

func TestPermissions_GetEffectivePermissions_Dev(t *testing.T) {
	h, tdb, _, _ := newPermissionsHandler(t)

	devID := seedDevUser(t, context.Background(), tdb.Pool)
	devCtx := middleware.WithAuthContext(context.Background(), services.AuthContext{
		UserID: devID,
		RoleID: 2,
	})

	res, err := h.MeGetEffectivePermissions(devCtx)
	require.NoError(t, err)

	effResp, ok := res.(*oas.EffectivePermissionsResponse)
	require.True(t, ok)

	assert.False(t, effResp.SuperAdmin, "dev 用户不是 super_admin")
	// dev role 在 0007 migration seed 拿到 16 条：
	//   nav (work, progress) = 2
	//   progress 全部 14 条 - project:delete = 13
	//   users:list:all = 1
	//   = 16
	assert.Len(t, effResp.Permissions, 16, "dev 默认 16 条权限")

	// sanity：含 nav:view:work 但不含 progress:project:delete
	assert.Contains(t, effResp.Permissions, "nav:view:work")
	assert.NotContains(t, effResp.Permissions, "progress:project:delete",
		"dev 不应该有 project 删除权限")
}

// ============================================================
// 4. GetRolePermissions_DevReturns16
// ============================================================
//
// GET /api/roles/{id}/permissions 由 RBACHandler 实现而非 PermissionsHandler；
// 但 catalog 字段 code 由 toOASPermissions 拼装，校验 3 段 code 一致性。
// 这里用一条 SELECT 直接核对，避免引入 RBACHandler 装配。

func TestPermissions_GetRolePermissions_DevReturns16(t *testing.T) {
	_, tdb, _, ctx := newPermissionsHandler(t)

	// 直接调 PermissionsService.ListRolePermissions（与 GET /api/roles/2/permissions
	// 同一份数据源，避免重复装配 RBACHandler）
	svc := services.NewPermissionsService(tdb.Pool)
	perms, err := svc.ListRolePermissions(ctx, 2)
	require.NoError(t, err)

	assert.Len(t, perms, 16, "dev role 默认 grant 16 条")
}

// ============================================================
// 5. UpdateRolePermissions_204 + token_version bump
// ============================================================

func TestPermissions_UpdateRolePermissions_204(t *testing.T) {
	h, tdb, ac, ctx := newPermissionsHandler(t)

	// 准备：先建一个 dev 用户，记初始 token_version
	devID := seedDevUser(t, ctx, tdb.Pool)
	beforeTV := readTokenVersion(t, ctx, tdb.Pool, devID)

	// 取一条权限 id 作为新 grant 集合
	var permID int64
	err := tdb.Pool.QueryRow(ctx, `
		SELECT id FROM permissions WHERE resource='nav' AND action='view' AND scope='progress'
	`).Scan(&permID)
	require.NoError(t, err)

	// 用 admin 身份调 handler，目标 dev role (id=2)
	res, err := h.RolesUpdatePermissions(ctx, &oas.RolePermissionUpdateRequest{
		PermissionIds: []int64{permID},
	}, oas.RolesUpdatePermissionsParams{ID: 2})
	require.NoError(t, err)

	_, ok := res.(*oas.RolesUpdatePermissionsNoContent)
	require.True(t, ok, "204 应返回 *RolesUpdatePermissionsNoContent；实际 %T", res)

	// 副作用 1：dev role 的 grants 被替换为 1 条
	svc := services.NewPermissionsService(tdb.Pool)
	after, err := svc.ListRolePermissions(ctx, 2)
	require.NoError(t, err)
	assert.Len(t, after, 1, "全量替换后 grants 应只剩 1 条")
	assert.Equal(t, permID, after[0].ID)

	// 副作用 2：dev 用户 token_version 应 +1（让旧 access token 必 401）
	afterTV := readTokenVersion(t, ctx, tdb.Pool, devID)
	assert.Equal(t, beforeTV+1, afterTV, "dev 用户 token_version 应被 bump")

	_ = ac // ac 只是装上下文身份；本用例不再用
}

// ============================================================
// 6. UpdateRolePermissions_SuperAdminBlocked（中间件级拦截）
// ============================================================
//
// 这是唯一走完整 router 的用例，验证 SuperAdminInvariants 中间件
// 真正挂在 NewRouter 上：HTTP-level 应该 422 + super_admin_immutable
// 而不是被 handler service 兜底 422（虽然两者都能拒，但中间件先发更友好且省 DB roundtrip）。

func TestPermissions_UpdateRolePermissions_SuperAdminBlocked(t *testing.T) {
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	router := buildPermissionTestRouter(t, tdb.Pool)
	ts := httptest.NewServer(router)
	defer ts.Close()

	// 拼请求：PUT /api/roles/1/permissions（roleID=1 是 super_admin）
	body, _ := json.Marshal(map[string]any{"permissionIds": []int64{}})
	req, err := http.NewRequest(http.MethodPut, ts.URL+"/api/roles/1/permissions", bytes.NewReader(body))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")

	// 注：这里没带 Authorization。中间件 SuperAdminInvariants 不依赖 ogen security，
	// 路径形态匹配即拦截 → 直接 422，不会走到 ogen 的 401 分支。
	// 这正好验证中间件挂载在 ogen mount 之前的顺序。
	resp, err := ts.Client().Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusUnprocessableEntity, resp.StatusCode,
		"super_admin 角色权限写入应被中间件 422 拦截")

	var envelope struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&envelope))
	assert.Equal(t, "super_admin_immutable", envelope.Error.Code)
}

// buildPermissionTestRouter 构造一个最小可路由的 chi router 用于中间件级测试。
//
// 业务背景：api.NewRouter 需要一组完整 services；这里逐个用真实 constructor 装配
// （都是 pool-backed，启动开销可忽略）。只要中间件能 422 拦截即可，不会走到任何
// service 真实代码 —— 中间件优先于 ogen handler。
func buildPermissionTestRouter(t *testing.T, pool *pgxpool.Pool) http.Handler {
	t.Helper()
	authSvc, err := services.NewAuthService(services.AuthServiceDeps{
		Pool:          pool,
		AccessSecret:  []byte("test-access-secret-32-bytes-xx"),
		RefreshSecret: []byte("test-refresh-secret-32-bytes-yy"),
		AccessTTL:     15 * time.Minute,
		RefreshTTL:    7 * 24 * time.Hour,
		BcryptCost:    bcrypt.MinCost,
	})
	require.NoError(t, err)

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

	router, err := api.NewRouter(api.RouterDeps{
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

// ============================================================
// 7. GetUserPermissionOverrides_Empty
// ============================================================

func TestPermissions_GetUserPermissionOverrides_Empty(t *testing.T) {
	h, tdb, _, ctx := newPermissionsHandler(t)
	devID := seedDevUser(t, ctx, tdb.Pool)

	res, err := h.UsersGetPermissionOverrides(ctx, oas.UsersGetPermissionOverridesParams{ID: devID})
	require.NoError(t, err)

	listResp, ok := res.(*oas.UserPermissionOverridesResponse)
	require.True(t, ok, "200 应返回 *UserPermissionOverridesResponse；实际 %T", res)

	assert.Equal(t, devID, listResp.UserId)
	assert.Empty(t, listResp.Overrides, "新建 dev 用户应无任何 override")
}

// ============================================================
// 8. UpdateUserPermissionOverrides_204 + token_version bump
// ============================================================

func TestPermissions_UpdateUserPermissionOverrides_204(t *testing.T) {
	h, tdb, _, ctx := newPermissionsHandler(t)
	devID := seedDevUser(t, ctx, tdb.Pool)
	beforeTV := readTokenVersion(t, ctx, tdb.Pool, devID)

	// 挑一条 permission 做 deny
	var permID int64
	err := tdb.Pool.QueryRow(ctx, `
		SELECT id FROM permissions WHERE resource='progress' AND action='feedback' AND scope='create'
	`).Scan(&permID)
	require.NoError(t, err)

	res, err := h.UsersUpdatePermissionOverrides(ctx, &oas.UpdateUserPermissionOverridesRequest{
		Overrides: []oas.UserPermissionOverride{
			{PermissionId: permID, Effect: oas.UserPermissionOverrideEffectDeny},
		},
	}, oas.UsersUpdatePermissionOverridesParams{ID: devID})
	require.NoError(t, err)

	_, ok := res.(*oas.UsersUpdatePermissionOverridesNoContent)
	require.True(t, ok, "204 应返回 *UsersUpdatePermissionOverridesNoContent；实际 %T", res)

	// 副作用 1：DB 落入一条 deny
	var count int
	err = tdb.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM user_permissions
		WHERE user_id = $1 AND permission_id = $2 AND effect = 'deny'
	`, devID, permID).Scan(&count)
	require.NoError(t, err)
	assert.Equal(t, 1, count, "user_permissions 应有一条 deny 行")

	// 副作用 2：token_version 必 +1
	afterTV := readTokenVersion(t, ctx, tdb.Pool, devID)
	assert.Equal(t, beforeTV+1, afterTV, "user 写覆写应 bump token_version")
}
