/*
@file permissions_service_test.go
@description PermissionsService 端到端测试（dockertest postgres + 0007 schema）。

覆盖（12 个用例）：
   1. ListRolePermissions_DevReturns16              — list role 2 (dev) 返回 16 条
   2. ListRolePermissions_UnknownRoleReturnsEmpty   — 未知 role 返回 []
   3. UpdateRolePermissions_ReplacesAllGrants       — PUT 替换后 list 命中且仅命中新集合
   4. UpdateRolePermissions_BumpsTokenVersionForRoleUsers — 该 role 全部用户 token_version + 1
   5. UpdateRolePermissions_RejectsSuperAdmin       — roleID=1 → ErrSuperAdminImmutable，DB 不动
   6. UpdateRolePermissions_UnknownRole             — 未知 role → ErrRoleNotFound
   7. ListUserOverrides_NonExistentUser             — userID 不存在 → ErrUserNotFound
   8. UpdateUserOverrides_ReplacesAllOverrides      — PUT 替换后 list 仅返新集合
   9. UpdateUserOverrides_BumpsTokenVersionOfUser   — 仅该 user bump，其它同 role 不动
  10. UpdateUserOverrides_RejectsSuperAdmin         — user.role_id=1 → ErrSuperAdminImmutable
  11. UpdateUserOverrides_RejectsInvalidEffect      — effect=maybe → ErrInvalidEffect
  12. UpdateRolePermissions_TransactionalRollback   — 非法 permission_id (FK) → tx 回滚，DELETE 也不生效

设计取舍：
  - dockertest 真实 DB 而非 mock：本服务核心是事务语义 + token_version bump，
    用 mock 验证不到 DELETE/INSERT/UPDATE 三步之间的事务原子性
  - 复用 effective_permissions_service_test.go 已建好的 seedDevUser / permIDByCode / insertUserPerm
    helper（同 package services_test 内可见）

@author Atlas.oi
@date 2026-05-02
*/

package services_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ghostterm/progress-server/internal/services"
	"github.com/ghostterm/progress-server/tests/fixtures"
)

// ============================================================
// 本地 helper：拿 token_version / 拿 role 的全部 permission ids
// ============================================================

// getTokenVersion 读取某 user 当前 token_version；用于断言 bump 是否生效。
func getTokenVersion(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID int64) int64 {
	t.Helper()
	var v int64
	err := pool.QueryRow(ctx, `SELECT token_version FROM users WHERE id = $1`, userID).Scan(&v)
	require.NoError(t, err)
	return v
}

// listRolePermIDs 读取某 role 当前持有的 permission_id 集合（已排序）。
func listRolePermIDs(t *testing.T, ctx context.Context, pool *pgxpool.Pool, roleID int64) []int64 {
	t.Helper()
	rows, err := pool.Query(ctx, `
		SELECT permission_id FROM role_permissions WHERE role_id = $1 ORDER BY permission_id
	`, roleID)
	require.NoError(t, err)
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		require.NoError(t, rows.Scan(&id))
		out = append(out, id)
	}
	require.NoError(t, rows.Err())
	return out
}

// ============================================================
// 用例 1：dev role 返回 16 条
// ============================================================

func TestPermissions_ListRolePermissions_DevReturns16(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	svc := services.NewPermissionsService(tdb.Pool)
	perms, err := svc.ListRolePermissions(ctx, 2)
	require.NoError(t, err)
	// 0007 migration 给 role 2 (dev) 种子 16 条（与 EffectivePermissionsService_AdminReturnsRoleGrants 对齐）
	assert.Len(t, perms, 16, "dev role 应有 16 条种子权限")
	// 抽查：确认返回的 Permission 字段填充完整
	for _, p := range perms {
		assert.Greater(t, p.ID, int64(0))
		assert.NotEmpty(t, p.Resource)
		assert.NotEmpty(t, p.Action)
		assert.NotEmpty(t, p.Scope)
	}
}

// ============================================================
// 用例 2：未知 role 返回 []
// ============================================================

func TestPermissions_ListRolePermissions_UnknownRoleReturnsEmpty(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	svc := services.NewPermissionsService(tdb.Pool)
	perms, err := svc.ListRolePermissions(ctx, 999)
	require.NoError(t, err)
	require.NotNil(t, perms, "未知 role 应返 [] 而非 nil")
	assert.Empty(t, perms)
}

// ============================================================
// 用例 3：UpdateRolePermissions 全量替换
// ============================================================

func TestPermissions_UpdateRolePermissions_ReplacesAllGrants(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	admin := fixtures.SeedAdminAuthContext(t, ctx, tdb.Pool)

	// 选 3 条特定 permission：nav:view:work, nav:view:progress, users:list:all
	p1 := permIDByCode(t, ctx, tdb.Pool, "nav", "view", "work")
	p2 := permIDByCode(t, ctx, tdb.Pool, "nav", "view", "progress")
	p3 := permIDByCode(t, ctx, tdb.Pool, "users", "list", "all")

	svc := services.NewPermissionsService(tdb.Pool)
	err := svc.UpdateRolePermissions(ctx, 2, []int64{p1, p2, p3}, admin.UserID)
	require.NoError(t, err)

	// 验证：role 2 现在恰好持有这 3 条
	perms, err := svc.ListRolePermissions(ctx, 2)
	require.NoError(t, err)
	require.Len(t, perms, 3, "PUT 全量替换后必须只剩 3 条")

	gotIDs := make(map[int64]bool, 3)
	for _, p := range perms {
		gotIDs[p.ID] = true
	}
	assert.True(t, gotIDs[p1])
	assert.True(t, gotIDs[p2])
	assert.True(t, gotIDs[p3])
}

// ============================================================
// 用例 4：UpdateRolePermissions bump 该 role 全部用户 token_version
// ============================================================

func TestPermissions_UpdateRolePermissions_BumpsTokenVersionForRoleUsers(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	admin := fixtures.SeedAdminAuthContext(t, ctx, tdb.Pool)

	// 准备 2 个 dev 用户
	u1 := seedDevUser(t, ctx, tdb.Pool, "dev-perm-bump-1")
	u2 := seedDevUser(t, ctx, tdb.Pool, "dev-perm-bump-2")

	v1Before := getTokenVersion(t, ctx, tdb.Pool, u1)
	v2Before := getTokenVersion(t, ctx, tdb.Pool, u2)

	// 任意写一次（哪怕清空也算"配置变更"）
	svc := services.NewPermissionsService(tdb.Pool)
	err := svc.UpdateRolePermissions(ctx, 2, []int64{}, admin.UserID)
	require.NoError(t, err)

	v1After := getTokenVersion(t, ctx, tdb.Pool, u1)
	v2After := getTokenVersion(t, ctx, tdb.Pool, u2)

	assert.Equal(t, v1Before+1, v1After, "u1 token_version 必须 bump +1")
	assert.Equal(t, v2Before+1, v2After, "u2 token_version 必须 bump +1")
}

// ============================================================
// 用例 5：拒绝写超管（roleID=1）
// ============================================================

func TestPermissions_UpdateRolePermissions_RejectsSuperAdmin(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	admin := fixtures.SeedAdminAuthContext(t, ctx, tdb.Pool)
	// 0007 trigger 阻止超管写 role_permissions，所以 role 1 实际就没有 row。
	// 校验 service 层 early reject + 不动 DB
	beforeCount := len(listRolePermIDs(t, ctx, tdb.Pool, 1))
	beforeAdminVer := getTokenVersion(t, ctx, tdb.Pool, admin.UserID)

	svc := services.NewPermissionsService(tdb.Pool)
	err := svc.UpdateRolePermissions(ctx, 1, []int64{}, admin.UserID)
	require.Error(t, err)
	require.ErrorIs(t, err, services.ErrSuperAdminImmutable)

	afterCount := len(listRolePermIDs(t, ctx, tdb.Pool, 1))
	afterAdminVer := getTokenVersion(t, ctx, tdb.Pool, admin.UserID)
	assert.Equal(t, beforeCount, afterCount, "超管 role_permissions 不应被改动")
	assert.Equal(t, beforeAdminVer, afterAdminVer, "超管 token_version 不应 bump")
}

// ============================================================
// 用例 6：未知 role
// ============================================================

func TestPermissions_UpdateRolePermissions_UnknownRole(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	admin := fixtures.SeedAdminAuthContext(t, ctx, tdb.Pool)
	svc := services.NewPermissionsService(tdb.Pool)
	err := svc.UpdateRolePermissions(ctx, 999, []int64{}, admin.UserID)
	require.Error(t, err)
	require.ErrorIs(t, err, services.ErrRoleNotFound)
}

// ============================================================
// 用例 7：ListUserOverrides 未知 user
// ============================================================

func TestPermissions_ListUserOverrides_NonExistentUser(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	svc := services.NewPermissionsService(tdb.Pool)
	out, err := svc.ListUserOverrides(ctx, 99999999)
	require.Error(t, err)
	require.ErrorIs(t, err, services.ErrUserNotFound)
	assert.Nil(t, out)
}

// ============================================================
// 用例 8：UpdateUserOverrides 全量替换
// ============================================================

func TestPermissions_UpdateUserOverrides_ReplacesAllOverrides(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	admin := fixtures.SeedAdminAuthContext(t, ctx, tdb.Pool)
	dev := seedDevUser(t, ctx, tdb.Pool, "dev-perm-overrides")

	deletePerm := permIDByCode(t, ctx, tdb.Pool, "progress", "project", "delete")
	feedbackCreate := permIDByCode(t, ctx, tdb.Pool, "progress", "feedback", "create")
	usersCreate := permIDByCode(t, ctx, tdb.Pool, "users", "create", "all")

	svc := services.NewPermissionsService(tdb.Pool)

	// 第一次：插 2 条
	err := svc.UpdateUserOverrides(ctx, dev, []services.UserOverride{
		{PermissionID: deletePerm, Effect: "grant"},
		{PermissionID: feedbackCreate, Effect: "deny"},
	}, admin.UserID)
	require.NoError(t, err)

	out, err := svc.ListUserOverrides(ctx, dev)
	require.NoError(t, err)
	require.Len(t, out, 2)

	// 第二次：替换为完全不同的 1 条
	err = svc.UpdateUserOverrides(ctx, dev, []services.UserOverride{
		{PermissionID: usersCreate, Effect: "grant"},
	}, admin.UserID)
	require.NoError(t, err)

	out, err = svc.ListUserOverrides(ctx, dev)
	require.NoError(t, err)
	require.Len(t, out, 1, "PUT 全量替换后只剩 1 条")
	assert.Equal(t, usersCreate, out[0].PermissionID)
	assert.Equal(t, "grant", out[0].Effect)
}

// ============================================================
// 用例 9：UpdateUserOverrides 仅 bump 该 user，不动同 role 其它 user
// ============================================================

func TestPermissions_UpdateUserOverrides_BumpsTokenVersionOfUser(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	admin := fixtures.SeedAdminAuthContext(t, ctx, tdb.Pool)
	target := seedDevUser(t, ctx, tdb.Pool, "dev-perm-bumpsingle-target")
	other := seedDevUser(t, ctx, tdb.Pool, "dev-perm-bumpsingle-other")

	deletePerm := permIDByCode(t, ctx, tdb.Pool, "progress", "project", "delete")

	tBefore := getTokenVersion(t, ctx, tdb.Pool, target)
	oBefore := getTokenVersion(t, ctx, tdb.Pool, other)

	svc := services.NewPermissionsService(tdb.Pool)
	err := svc.UpdateUserOverrides(ctx, target, []services.UserOverride{
		{PermissionID: deletePerm, Effect: "grant"},
	}, admin.UserID)
	require.NoError(t, err)

	tAfter := getTokenVersion(t, ctx, tdb.Pool, target)
	oAfter := getTokenVersion(t, ctx, tdb.Pool, other)

	assert.Equal(t, tBefore+1, tAfter, "target token_version 必须 bump +1")
	assert.Equal(t, oBefore, oAfter, "同 role 其它用户 token_version 不应被影响")
}

// ============================================================
// 用例 10：UpdateUserOverrides 拒绝目标为超管
// ============================================================

func TestPermissions_UpdateUserOverrides_RejectsSuperAdmin(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	admin := fixtures.SeedAdminAuthContext(t, ctx, tdb.Pool)
	deletePerm := permIDByCode(t, ctx, tdb.Pool, "progress", "project", "delete")

	beforeVer := getTokenVersion(t, ctx, tdb.Pool, admin.UserID)

	svc := services.NewPermissionsService(tdb.Pool)
	err := svc.UpdateUserOverrides(ctx, admin.UserID, []services.UserOverride{
		{PermissionID: deletePerm, Effect: "grant"},
	}, admin.UserID)
	require.Error(t, err)
	require.ErrorIs(t, err, services.ErrSuperAdminImmutable)

	afterVer := getTokenVersion(t, ctx, tdb.Pool, admin.UserID)
	assert.Equal(t, beforeVer, afterVer, "超管 token_version 不应被 bump")
}

// ============================================================
// 用例 11：UpdateUserOverrides 拒绝非法 effect
// ============================================================

func TestPermissions_UpdateUserOverrides_RejectsInvalidEffect(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	admin := fixtures.SeedAdminAuthContext(t, ctx, tdb.Pool)
	dev := seedDevUser(t, ctx, tdb.Pool, "dev-perm-invalideffect")
	deletePerm := permIDByCode(t, ctx, tdb.Pool, "progress", "project", "delete")

	beforeVer := getTokenVersion(t, ctx, tdb.Pool, dev)

	svc := services.NewPermissionsService(tdb.Pool)
	err := svc.UpdateUserOverrides(ctx, dev, []services.UserOverride{
		{PermissionID: deletePerm, Effect: "maybe"},
	}, admin.UserID)
	require.Error(t, err)
	require.ErrorIs(t, err, services.ErrInvalidEffect)

	// 校验完全没有副作用：DB 未动 + token_version 未 bump
	afterVer := getTokenVersion(t, ctx, tdb.Pool, dev)
	assert.Equal(t, beforeVer, afterVer)
	out, err := svc.ListUserOverrides(ctx, dev)
	require.NoError(t, err)
	assert.Empty(t, out)
}

// ============================================================
// 用例 12：UpdateRolePermissions FK 失败时事务回滚
// 业务保证：DELETE + INSERT + UPDATE 三步必须原子；任意一步失败回到未动状态
// ============================================================

func TestPermissions_UpdateRolePermissions_TransactionalRollback(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	admin := fixtures.SeedAdminAuthContext(t, ctx, tdb.Pool)

	// 拿 role 2 当前的 permission ids 与某 dev user 的 token_version 作 baseline
	beforePerms := listRolePermIDs(t, ctx, tdb.Pool, 2)
	require.NotEmpty(t, beforePerms, "前置：dev role 应有种子权限")

	dev := seedDevUser(t, ctx, tdb.Pool, "dev-perm-tx-rollback")
	beforeVer := getTokenVersion(t, ctx, tdb.Pool, dev)

	// 选一个真正存在的 permission_id 与一个绝对不存在的 ID 混合
	validPerm := beforePerms[0]
	invalidPerm := int64(0) // permissions.id 是 BIGSERIAL，0 必不存在 → FK 拒绝

	svc := services.NewPermissionsService(tdb.Pool)
	err := svc.UpdateRolePermissions(ctx, 2, []int64{validPerm, invalidPerm}, admin.UserID)
	require.Error(t, err, "FK 违反应让事务回滚并返回错误")

	// 验证：role 2 的 permission 集合不变（DELETE 也被回滚）
	afterPerms := listRolePermIDs(t, ctx, tdb.Pool, 2)
	assert.Equal(t, beforePerms, afterPerms, "事务回滚后 role permissions 必须复原")

	// 验证：token_version 也未 bump
	afterVer := getTokenVersion(t, ctx, tdb.Pool, dev)
	assert.Equal(t, beforeVer, afterVer, "事务回滚后 token_version 也不应 bump")
}

