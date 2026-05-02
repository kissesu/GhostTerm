/*
@file effective_permissions_service_test.go
@description EffectivePermissionsService 端到端测试（dockertest postgres + 0007 schema）。

覆盖（12 个用例）：
  1. SuperAdminReturnsWildcard          — role_id=1 直接 ["*:*"] 哨兵
  2. AdminReturnsRoleGrants             — dev (role_id=2) 返回 0007 种子的 16 条
  3. UserGrantSupplementsRole           — user_permissions(grant) 增量加入
  4. UserDenyOverridesRoleGrant         — user_permissions(deny) 从 role grants 中扣除
  5. UnknownPermutationConsistent       — DB PK 阻止同 (user,perm) 双行；回退测多次调用结果一致
  6. UnknownUserReturnsError            — 未知 userID 报错且包含 "not found"
  7. RoleWithNoPermissionsReturnsEmpty  — 新角色 0 grants → 空切片
  8. SuperAdminUserPermissionsBlocked   — INSERT user_permissions 给超管被 trigger 拒绝；Compute 仍 ["*:*"]
  9. PermissionCodeFormat               — 所有返回码必须是 resource:action:scope（恰 2 个冒号）
 10. WildcardNotAutoExpanded            — 普通用户绝不会拿到 "*:*"
 11. ConcurrentCallsThreadSafe          — 10 goroutine 并发同一 userID 结果完全相同
 12. AllUserDeniesEmptyResult           — deny 全部 role grants → 空切片

设计取舍：
  - 不走 InTx + SET LOCAL ROLE：permissions / role_permissions / user_permissions / users
    四张表均未启用 RLS（见 0002_rls.up.sql）；postgres 超级用户连接直查即可
  - 用 dockertest（fixtures.NewTestDB）保持与其它 service 测试一致；不用 mock
  - 用例 #5（plan 描述的 "GrantAndDenySamePermDenyWins"）受 PRIMARY KEY (user_id, permission_id)
    阻止两行同时存在，无法在 DB 层构造；按 plan 指引 adapt 为"多次调用一致性"用例

@author Atlas.oi
@date 2026-05-02
*/

package services_test

import (
	"context"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"github.com/ghostterm/progress-server/internal/auth"
	"github.com/ghostterm/progress-server/internal/services"
	"github.com/ghostterm/progress-server/tests/fixtures"
)

// ============================================================
// 本地 helper：seed dev / customer_service 用户（非超管），返回 userID
// ============================================================

// seedDevUser 插入一个 role_id=2 (dev) 普通用户，返回 id。
//
// 业务背景：fixtures 里只有 SeedAdminAuthContext（复用 0001 admin）和
// SeedNonMemberAuthContext（dev 但不加 project_members）。effective_permissions
// 不关心 project_members，只关心 role_id + user_permissions，因此本地内联
// 一个最小 INSERT 就够；不需要再扩 fixtures 包。
func seedDevUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, username string) int64 {
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

// permIDByCode 查找一个 permission 的 id；测试常用来"挑一条权限插 user_permissions"。
func permIDByCode(t *testing.T, ctx context.Context, pool *pgxpool.Pool, resource, action, scope string) int64 {
	t.Helper()
	var id int64
	err := pool.QueryRow(ctx, `
		SELECT id FROM permissions WHERE resource=$1 AND action=$2 AND scope=$3
	`, resource, action, scope).Scan(&id)
	require.NoError(t, err, "permission %s:%s:%s not found", resource, action, scope)
	return id
}

// insertUserPerm 给 (userID, permID) 插一条 user_permissions(effect)。
// createdBy 用 superAdminID（0001 admin）即可，因为 created_by 只是审计字段。
func insertUserPerm(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID, permID int64, effect string, createdBy int64) {
	t.Helper()
	_, err := pool.Exec(ctx, `
		INSERT INTO user_permissions (user_id, permission_id, effect, created_by)
		VALUES ($1, $2, $3::permission_effect, $4)
	`, userID, permID, effect, createdBy)
	require.NoError(t, err)
}

// devRoleSeedCodes 列出 0007 migration 给 role_id=2 (dev) 种子的全部权限码（共 16 条）。
//
// 业务背景：0007_user_permissions.up.sql 第 145-149 行 SELECT 条件：
//   - nav AND scope IN ('work','progress')          → 2 条 (nav:view:work, nav:view:progress)
//   - resource='progress' 且 NOT delete            → 13 条
//   - users AND action='list'                       → 1 条 (users:list:all)
// 合计 16 条，已排序便于断言。
func devRoleSeedCodes() []string {
	return []string{
		"nav:view:progress",
		"nav:view:work",
		"progress:event:trigger",
		"progress:feedback:create",
		"progress:feedback:list",
		"progress:file:list",
		"progress:file:upload",
		"progress:payment:create",
		"progress:payment:list",
		"progress:project:create",
		"progress:project:edit",
		"progress:project:list",
		"progress:quote:change",
		"progress:thesis:list",
		"progress:thesis:upload",
		"users:list:all",
	}
}

// ============================================================
// 用例 1：超管直接返 ["*:*"]
// ============================================================

func TestEffectivePermissions_SuperAdminReturnsWildcard(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	auth := fixtures.SeedAdminAuthContext(t, ctx, tdb.Pool)
	svc := services.NewEffectivePermissionsService(tdb.Pool)

	got, err := svc.Compute(ctx, auth.UserID)
	require.NoError(t, err)
	require.Equal(t, []string{"*:*"}, got, "超管必须直接返哨兵 *:*")
}

// ============================================================
// 用例 2：dev 角色返回 0007 种子的 16 条
// ============================================================

func TestEffectivePermissions_AdminReturnsRoleGrants(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	devID := seedDevUser(t, ctx, tdb.Pool, "dev-effperm-roleseed")
	svc := services.NewEffectivePermissionsService(tdb.Pool)

	got, err := svc.Compute(ctx, devID)
	require.NoError(t, err)
	assert.Equal(t, devRoleSeedCodes(), got, "dev role 应返回 0007 种子的 16 条已排序权限码")
}

// ============================================================
// 用例 3：user_permissions(grant) 增量加入
// ============================================================

func TestEffectivePermissions_UserGrantSupplementsRole(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	admin := fixtures.SeedAdminAuthContext(t, ctx, tdb.Pool)
	devID := seedDevUser(t, ctx, tdb.Pool, "dev-effperm-grant")
	// dev 缺省没有 'progress:project:delete'；通过 user_permissions(grant) 单独授予
	deletePermID := permIDByCode(t, ctx, tdb.Pool, "progress", "project", "delete")
	insertUserPerm(t, ctx, tdb.Pool, devID, deletePermID, "grant", admin.UserID)

	svc := services.NewEffectivePermissionsService(tdb.Pool)
	got, err := svc.Compute(ctx, devID)
	require.NoError(t, err)
	assert.Contains(t, got, "progress:project:delete", "grant 应让 delete 权限补进结果")
	// 同时 role 原 16 条仍在
	for _, code := range devRoleSeedCodes() {
		assert.Contains(t, got, code, "原 role grant %s 不应丢失", code)
	}
}

// ============================================================
// 用例 4：user_permissions(deny) 从 role grants 中扣除
// ============================================================

func TestEffectivePermissions_UserDenyOverridesRoleGrant(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	admin := fixtures.SeedAdminAuthContext(t, ctx, tdb.Pool)
	devID := seedDevUser(t, ctx, tdb.Pool, "dev-effperm-deny")
	// dev 默认有 'progress:feedback:create'；用 deny 把它扣回
	feedbackCreatePermID := permIDByCode(t, ctx, tdb.Pool, "progress", "feedback", "create")
	insertUserPerm(t, ctx, tdb.Pool, devID, feedbackCreatePermID, "deny", admin.UserID)

	svc := services.NewEffectivePermissionsService(tdb.Pool)
	got, err := svc.Compute(ctx, devID)
	require.NoError(t, err)
	assert.NotContains(t, got, "progress:feedback:create", "deny 应让该 perm 从结果消失")
	// 其它 15 条不受影响
	assert.Len(t, got, 15)
}

// ============================================================
// 用例 5：DB PK 阻止同 (user,perm) 双行；测多次调用一致
// ============================================================
//
// plan 原描述 "GrantAndDenySamePermDenyWins"：因为 user_permissions PRIMARY KEY (user_id, permission_id)
// 物理上不可能让同一 (user,perm) 同时有 grant 和 deny 行，DB 会立即拒绝第二条 INSERT。
// 改为：先验证 PK 唯一约束生效，再验证仅有 deny 时 Compute 行为一致。

func TestEffectivePermissions_UnknownPermutationConsistent(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	admin := fixtures.SeedAdminAuthContext(t, ctx, tdb.Pool)
	devID := seedDevUser(t, ctx, tdb.Pool, "dev-effperm-pk")
	feedbackCreatePermID := permIDByCode(t, ctx, tdb.Pool, "progress", "feedback", "create")

	// 先插 grant
	insertUserPerm(t, ctx, tdb.Pool, devID, feedbackCreatePermID, "grant", admin.UserID)
	// 再插 deny 同 (user,perm) 应被 PK 拒绝
	_, err := tdb.Pool.Exec(ctx, `
		INSERT INTO user_permissions (user_id, permission_id, effect, created_by)
		VALUES ($1, $2, 'deny', $3)
	`, devID, feedbackCreatePermID, admin.UserID)
	require.Error(t, err, "PRIMARY KEY (user_id, permission_id) 必须阻止同 (user,perm) 双行")

	// 仅有 grant 行时，Compute 多次结果一致（grant 本来就在 role 集合里，是 no-op union）
	svc := services.NewEffectivePermissionsService(tdb.Pool)
	first, err := svc.Compute(ctx, devID)
	require.NoError(t, err)
	for i := 0; i < 3; i++ {
		next, err := svc.Compute(ctx, devID)
		require.NoError(t, err)
		assert.Equal(t, first, next, "多次调用结果必须一致")
	}
}

// ============================================================
// 用例 6：未知用户报错
// ============================================================

func TestEffectivePermissions_UnknownUserReturnsError(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	svc := services.NewEffectivePermissionsService(tdb.Pool)
	got, err := svc.Compute(ctx, 99999999)
	require.Error(t, err)
	require.ErrorIs(t, err, services.ErrUserNotFound)
	require.Nil(t, got)
}

// ============================================================
// 用例 7：新建零 grants 角色，对应用户返回空切片
// ============================================================

func TestEffectivePermissions_RoleWithNoPermissionsReturnsEmpty(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	// 1. 插一个新角色（id 必须显式给 —— roles.id 是 BIGINT PRIMARY KEY 无 default）；不写 role_permissions
	// 用 99 避开 0001 已占用的 1/2/3 与未来可能的扩展号段
	const tempRoleID int64 = 99
	_, err := tdb.Pool.Exec(ctx, `
		INSERT INTO roles (id, name, description, is_system)
		VALUES ($1, 'temp_role_effperm', 'no perms', FALSE)
	`, tempRoleID)
	require.NoError(t, err)

	// 2. 插一个用户绑该角色
	hash, err := auth.HashPassword("password", bcrypt.MinCost)
	require.NoError(t, err)
	var userID int64
	err = tdb.Pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, display_name, role_id, is_active)
		VALUES ('user-temp-role', $1, 'Temp', $2, TRUE)
		RETURNING id
	`, hash, tempRoleID).Scan(&userID)
	require.NoError(t, err)

	svc := services.NewEffectivePermissionsService(tdb.Pool)
	got, err := svc.Compute(ctx, userID)
	require.NoError(t, err)
	require.NotNil(t, got, "无权限时应返 [] 而不是 nil")
	assert.Empty(t, got)
}

// ============================================================
// 用例 8：trigger 阻止给超管插 user_permissions；超管 Compute 仍是 ["*:*"]
// ============================================================

func TestEffectivePermissions_SuperAdminUserPermissionsBlocked(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	admin := fixtures.SeedAdminAuthContext(t, ctx, tdb.Pool)
	// 试图给超管插一条 deny 应被 0007 trigger 拒绝
	feedbackCreatePermID := permIDByCode(t, ctx, tdb.Pool, "progress", "feedback", "create")
	_, err := tdb.Pool.Exec(ctx, `
		INSERT INTO user_permissions (user_id, permission_id, effect, created_by)
		VALUES ($1, $2, 'deny', $1)
	`, admin.UserID, feedbackCreatePermID)
	require.Error(t, err, "0007 trigger 应拒绝任何指向 super_admin 的 user_permissions 写入")
	assert.Contains(t, err.Error(), "super_admin_immutable")

	// Compute 仍然返回 wildcard
	svc := services.NewEffectivePermissionsService(tdb.Pool)
	got, err := svc.Compute(ctx, admin.UserID)
	require.NoError(t, err)
	assert.Equal(t, []string{"*:*"}, got)
}

// ============================================================
// 用例 9：所有码必须是 resource:action:scope 三段式
// ============================================================

func TestEffectivePermissions_PermissionCodeFormat(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	devID := seedDevUser(t, ctx, tdb.Pool, "dev-effperm-format")
	svc := services.NewEffectivePermissionsService(tdb.Pool)

	got, err := svc.Compute(ctx, devID)
	require.NoError(t, err)
	require.NotEmpty(t, got)

	for _, code := range got {
		parts := strings.Split(code, ":")
		assert.Equal(t, 3, len(parts),
			"权限码 %q 必须是 resource:action:scope 三段式（恰 2 个冒号）", code)
		for i, part := range parts {
			assert.NotEmpty(t, part, "权限码 %q 第 %d 段不能为空", code, i)
		}
	}
}

// ============================================================
// 用例 10：普通用户不会拿到 *:*
// ============================================================

func TestEffectivePermissions_WildcardNotAutoExpanded(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	devID := seedDevUser(t, ctx, tdb.Pool, "dev-effperm-nowildcard")
	svc := services.NewEffectivePermissionsService(tdb.Pool)

	got, err := svc.Compute(ctx, devID)
	require.NoError(t, err)
	assert.NotContains(t, got, "*:*", "非超管绝不能拿到 *:* 哨兵")
}

// ============================================================
// 用例 11：10 goroutine 并发调用结果一致
// ============================================================

func TestEffectivePermissions_ConcurrentCallsThreadSafe(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	devID := seedDevUser(t, ctx, tdb.Pool, "dev-effperm-concurrent")
	svc := services.NewEffectivePermissionsService(tdb.Pool)

	// 先取 baseline
	baseline, err := svc.Compute(ctx, devID)
	require.NoError(t, err)

	const N = 10
	var wg sync.WaitGroup
	results := make([][]string, N)
	errs := make([]error, N)
	for i := 0; i < N; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			r, e := svc.Compute(ctx, devID)
			results[idx] = r
			errs[idx] = e
		}(i)
	}
	wg.Wait()

	for i := 0; i < N; i++ {
		require.NoErrorf(t, errs[i], "goroutine %d failed", i)
		assert.Equalf(t, baseline, results[i], "goroutine %d 返回结果与 baseline 不一致", i)
	}
}

// ============================================================
// 用例 12：deny 全部 role grants → 空切片
// ============================================================

func TestEffectivePermissions_AllUserDeniesEmptyResult(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	admin := fixtures.SeedAdminAuthContext(t, ctx, tdb.Pool)
	devID := seedDevUser(t, ctx, tdb.Pool, "dev-effperm-allden")

	// 拿到 dev 角色的所有 role_permissions.permission_id 列表
	rows, err := tdb.Pool.Query(ctx, `
		SELECT permission_id FROM role_permissions WHERE role_id = 2
	`)
	require.NoError(t, err)
	var permIDs []int64
	for rows.Next() {
		var pid int64
		require.NoError(t, rows.Scan(&pid))
		permIDs = append(permIDs, pid)
	}
	require.NoError(t, rows.Err())
	rows.Close()
	require.NotEmpty(t, permIDs, "dev role 必须有种子权限")

	// 全部 deny
	for _, pid := range permIDs {
		insertUserPerm(t, ctx, tdb.Pool, devID, pid, "deny", admin.UserID)
	}

	svc := services.NewEffectivePermissionsService(tdb.Pool)
	got, err := svc.Compute(ctx, devID)
	require.NoError(t, err)
	require.NotNil(t, got, "全部 deny 时应返 [] 而非 nil")
	assert.Empty(t, got, "全部 role grants 被 deny 后结果必须为空")
}
