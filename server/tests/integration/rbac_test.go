/*
@file rbac_test.go
@description RBACService + GUC tx injection + RLS 端到端集成测试。
             覆盖：
               1. RBACService.HasPermission / LoadUserPermissions 真实查 role_permissions
               2. db.SetSessionContext 注入后 RLS helper 看到正确身份（current_user_id / is_admin / is_member）
               3. RLS 隔离：dev 用户在自己事务里 SELECT projects 只能看到 member 项目
               4. admin 用户在自己事务里 SELECT projects 看到全部项目
               5. CanTriggerEvent：admin 始终放行；dev 必须是项目成员

             关键证明点（用户痛点）：
             "dev 见到本不该看到的客服项目" —— 如果 RLS+GUC 哪一环漏了，本测试会立刻失败。
@author Atlas.oi
@date 2026-04-29
*/

package integration

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"github.com/ghostterm/progress-server/internal/auth"
	progressdb "github.com/ghostterm/progress-server/internal/db"
	"github.com/ghostterm/progress-server/internal/services"
	"github.com/ghostterm/progress-server/internal/testutil"
)

// rbacTestEnv 装配整个测试环境：admin + dev 两个用户、一个项目（dev 不是该项目 member）。
type rbacTestEnv struct {
	pool      *pgxpool.Pool
	cleanup   func()
	rbacSvc   services.RBACService
	adminID   int64
	devID     int64
	otherDevID int64 // 第二个 dev，用于"非 member 也能看到"的反例对照（实际不会被加入 member）
	projectID int64
}

func setupRBACEnv(t *testing.T) *rbacTestEnv {
	t.Helper()
	pool, cleanup := testutil.StartPostgres(t)

	rbacSvc, err := services.NewRBACService(services.RBACServiceDeps{
		Pool: pool,
		// 测试关掉缓存方便观察 DB 行为
		CacheTTL: 1 * time.Nanosecond,
	})
	require.NoError(t, err)

	hash, err := auth.HashPassword("password", bcrypt.MinCost)
	require.NoError(t, err)

	ctx := context.Background()

	// 1. 用户：admin / dev / other_dev / customer
	// 0007 migration 引入 users_super_admin_unique；复用 0001 已 INSERT 的 admin
	var adminID, devID, otherDevID, customerID int64
	require.NoError(t, pool.QueryRow(ctx, `
		SELECT id FROM users WHERE role_id = 1 LIMIT 1
	`).Scan(&adminID))
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, display_name, role_id, is_active)
		VALUES ('dev-rbac', $1, 'Dev', 2, TRUE)
		RETURNING id
	`, hash).Scan(&devID))
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, display_name, role_id, is_active)
		VALUES ('dev2-rbac', $1, 'Dev2', 2, TRUE)
		RETURNING id
	`, hash).Scan(&otherDevID))
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, display_name, role_id, is_active)
		VALUES ('cs-rbac', $1, 'Customer Service', 3, TRUE)
		RETURNING id
	`, hash).Scan(&customerID))

	// 2. 项目：客服创建；只把 dev（不是 otherDev）作为 member
	//    用户需求修正 2026-04-30：客户从独立资源降级为 customer_label 字段
	//    pool 直连不走 RLS（postgres 超级用户 == owner，FORCE RLS 也过不掉，
	//    但 testutil 用 postgres 用户连接，FORCE 仅对非 superuser 起作用），
	//    因此 setup 直接 INSERT 不需要 GUC；后面的 read 测试才在事务内 SET LOCAL
	var projectID int64
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO projects (name, customer_label, description, deadline, created_by)
		VALUES ('TestProject', 'TestCustomer', 'desc', NOW() + INTERVAL '30 days', $1)
		RETURNING id
	`, customerID).Scan(&projectID))

	// 4. project_members 把 dev 加为成员；otherDev 不加
	_, err = pool.Exec(ctx, `
		INSERT INTO project_members (project_id, user_id, role)
		VALUES ($1, $2, 'dev')
	`, projectID, devID)
	require.NoError(t, err)

	// 5. RBAC 测试 fixture：补回旧权限码集合
	//
	// 业务背景：
	//   - 0007 migration 已 TRUNCATE permissions + role_permissions 并按新模型
	//     (nav/progress/users/permissions) 重新种子；
	//   - 但本测试断言的是 RBAC service 的"旧 v1 权限码语义"（project:read /
	//     project:update / file:upload / file:read / project:create 等），
	//     这些码在新 catalog 下不存在。Task 8 (RBAC middleware 改造) 会让 service
	//     直接接 EffectivePermissionsService，届时这些断言会被新断言替换。
	//   - 当下为让"测试链路完整"，本 fixture 在测试容器里再 INSERT 一遍旧权限码：
	//       * 通配 ('*','*','all') 给 role_id=1（trigger 阻断超管 INSERT，需先 DISABLE）
	//       * 旧 dev 权限给 role_id=2
	//       * 旧 cs  权限给 role_id=3
	//   - 这是测试隔离的 fixture，不影响生产 schema 或迁移产物。
	seedLegacyRBACPerms(t, ctx, pool)

	return &rbacTestEnv{
		pool:       pool,
		cleanup:    cleanup,
		rbacSvc:    rbacSvc,
		adminID:    adminID,
		devID:      devID,
		otherDevID: otherDevID,
		projectID:  projectID,
	}
}

// seedLegacyRBACPerms 为旧 v1 权限码补回 catalog + role 绑定。
//
// 业务流程：
//  1. INSERT 旧 permissions 行（ON CONFLICT DO NOTHING 防止与新 catalog 撞）
//  2. 给 role 2/3 绑定它们对应的旧权限码
//  3. 给 role 1 绑定 ('*','*','all') 通配；trigger prevent_super_admin_role_permission_write
//     会拒绝该 INSERT，需先 DISABLE TRIGGER（仅在测试容器内）
//
// 设计取舍：
//   - 不动 migration —— 0007 是产线契约，本 fixture 仅修补测试假设差异
//   - DISABLE TRIGGER 后必须 ENABLE 回去，否则后续测试场景验不到 trigger 守护行为
//   - 用 ON CONFLICT 而非 TRUNCATE：保留 0007 reseed 的新 catalog 行让其它路径仍有效
func seedLegacyRBACPerms(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()

	// 1. 旧 permissions 行（含通配）
	_, err := pool.Exec(ctx, `
		INSERT INTO permissions (resource, action, scope) VALUES
			('project',  'read',   'member'),
			('project',  'update', 'member'),
			('project',  'create', 'all'),
			('file',     'read',   'member'),
			('file',     'upload', 'all'),
			('event',    'E10',    'all'),
			('*',        '*',      'all')
		ON CONFLICT (resource, action, scope) DO NOTHING
	`)
	require.NoError(t, err)

	// 2. role 2 (dev) 绑定旧 dev 权限（注意不绑 project:create / 通配）
	_, err = pool.Exec(ctx, `
		INSERT INTO role_permissions (role_id, permission_id)
			SELECT 2, id FROM permissions
			WHERE (resource, action, scope) IN (
				('project', 'read',   'member'),
				('project', 'update', 'member'),
				('file',    'read',   'member'),
				('file',    'upload', 'all')
			)
		ON CONFLICT DO NOTHING
	`)
	require.NoError(t, err)

	// 3. role 3 (cs) 绑定旧 cs 权限（含 project:create）
	_, err = pool.Exec(ctx, `
		INSERT INTO role_permissions (role_id, permission_id)
			SELECT 3, id FROM permissions
			WHERE (resource, action, scope) IN (
				('project', 'read',   'member'),
				('project', 'create', 'all'),
				('file',    'upload', 'all')
			)
		ON CONFLICT DO NOTHING
	`)
	require.NoError(t, err)

	// 4. role 1 (super_admin) 绑定通配；trigger 阻断 → 临时 DISABLE 后再 ENABLE
	_, err = pool.Exec(ctx, `ALTER TABLE role_permissions DISABLE TRIGGER prevent_super_admin_role_permission_write`)
	require.NoError(t, err)
	defer func() {
		_, _ = pool.Exec(ctx, `ALTER TABLE role_permissions ENABLE TRIGGER prevent_super_admin_role_permission_write`)
	}()
	_, err = pool.Exec(ctx, `
		INSERT INTO role_permissions (role_id, permission_id)
			SELECT 1, id FROM permissions WHERE (resource, action, scope) = ('*', '*', 'all')
		ON CONFLICT DO NOTHING
	`)
	require.NoError(t, err)
}

// ============================================================
// 1. HasPermission：DB-driven 真实查询
// ============================================================

func TestRBAC_HasPermission_AdminWildcard(t *testing.T) {
	env := setupRBACEnv(t)
	defer env.cleanup()

	// admin (role_id=1) 由 0001 migration 预置 *:* 通配
	// 用户需求修正 2026-04-30：customer:create 权限已删除（客户降级为字段）
	for _, perm := range []string{"project:read", "project:create", "event:E10", "anything:goes"} {
		ok, err := env.rbacSvc.HasPermission(context.Background(), env.adminID, 1, perm)
		require.NoError(t, err)
		assert.True(t, ok, "admin 应拥有 %q 权限", perm)
	}
}

func TestRBAC_HasPermission_DevHasMemberPerms(t *testing.T) {
	env := setupRBACEnv(t)
	defer env.cleanup()

	// dev (role_id=2) 应有 project:read / project:update / file:upload 等
	cases := map[string]bool{
		"project:read":   true,
		"project:update": true,
		"file:upload":    true,
		"file:read":      true,
		// dev 没有 project:create
		"project:create": false,
	}
	for perm, want := range cases {
		got, err := env.rbacSvc.HasPermission(context.Background(), env.devID, 2, perm)
		require.NoError(t, err, perm)
		assert.Equal(t, want, got, "dev HasPermission(%q)", perm)
	}
}

// ============================================================
// 2. LoadUserPermissions：拿到 admin / dev 完整权限码集合
// ============================================================

func TestRBAC_LoadUserPermissions(t *testing.T) {
	env := setupRBACEnv(t)
	defer env.cleanup()

	// admin: 至少含 *:*
	adminPerms, err := env.rbacSvc.LoadUserPermissions(context.Background(), 1)
	require.NoError(t, err)
	assert.True(t, adminPerms["*:*"], "admin 应有 *:* 通配权限")

	// dev: 至少含 project:read 与 project:update
	devPerms, err := env.rbacSvc.LoadUserPermissions(context.Background(), 2)
	require.NoError(t, err)
	assert.True(t, devPerms["project:read"], "dev 应有 project:read")
	assert.True(t, devPerms["project:update"], "dev 应有 project:update")
	assert.False(t, devPerms["project:create"], "dev 不应有 project:create")

	// CS (role_id=3): 含 project:create（用户需求修正 2026-04-30：customer:* 已删除）
	csPerms, err := env.rbacSvc.LoadUserPermissions(context.Background(), 3)
	require.NoError(t, err)
	assert.True(t, csPerms["project:create"], "客服应有 project:create")
	assert.False(t, csPerms["customer:create"], "customer:* 权限应已被 0003 migration 删除")
}

// ============================================================
// 3. RLS GUC injection：dev 在自己 GUC 里 SELECT projects 只能看到 member 项目
//    （核心安全证明：避免 v1 的"开发越权读取所有客服项目"）
// ============================================================

func TestRBAC_RLS_DevOnlySeesMemberProjects(t *testing.T) {
	env := setupRBACEnv(t)
	defer env.cleanup()

	// 再造一个 dev2 不是 member 的项目（与 setup 中的 projectID 区分开）
	// 用户需求修正 2026-04-30：客户降级为 customer_label 字段，不再 SELECT FROM customers
	var otherProjectID int64
	require.NoError(t, env.pool.QueryRow(context.Background(), `
		INSERT INTO projects (name, customer_label, description, deadline, created_by)
		VALUES ('SecretProject', 'SecretCustomer', 'd', NOW() + INTERVAL '30 days', 1)
		RETURNING id
	`).Scan(&otherProjectID))

	// 关键验证：dev 在 GUC 内 SELECT projects 只看到 env.projectID，不看到 otherProjectID
	ctx := context.Background()

	// dev 视角
	devVisible, err := selectAccessibleProjects(ctx, env.pool, env.devID, 2)
	require.NoError(t, err)
	assert.Contains(t, devVisible, env.projectID, "dev 应看到自己 member 的项目")
	assert.NotContains(t, devVisible, otherProjectID,
		"dev 不能看到非 member 项目（RLS 拦截）—— 此处失败 = RLS+GUC 链路漏了")

	// otherDev 视角：非任何项目 member
	otherVisible, err := selectAccessibleProjects(ctx, env.pool, env.otherDevID, 2)
	require.NoError(t, err)
	assert.Empty(t, otherVisible, "非 member 用户应看到空（RLS 全部拦截）")

	// admin 视角：FORCE RLS 下 admin 走 is_admin() 通过策略，应看到全部 2 个项目
	adminVisible, err := selectAccessibleProjects(ctx, env.pool, env.adminID, 1)
	require.NoError(t, err)
	assert.Contains(t, adminVisible, env.projectID)
	assert.Contains(t, adminVisible, otherProjectID)
}

// selectAccessibleProjects 在事务内 SET ROLE progress_app + 注入 GUC 后 SELECT projects.id。
//
// 业务背景：
//   - testutil 用 postgres 超级用户连接 —— 超级用户隐式 BYPASSRLS，FORCE 也无效；
//     因此必须 SET LOCAL ROLE progress_app 切到受 RLS 约束的 role 才能验证 RLS 真实行为
//   - 生产环境 progress-server 直接以 progress_app 身份连接，不需要 SET ROLE
//   - SetSessionContext 之后 RLS helper（current_user_id / is_admin / is_member）按注入身份过滤
//   - commit 后事务级别的 SET LOCAL ROLE 与 GUC 一并失效，连接归还池是干净的
func selectAccessibleProjects(ctx context.Context, pool *pgxpool.Pool, userID, roleID int64) ([]int64, error) {
	var ids []int64
	err := progressdb.InTx(ctx, pool, func(tx pgx.Tx) error {
		// 切到 progress_app 让 FORCE RLS 生效
		if _, err := tx.Exec(ctx, `SET LOCAL ROLE progress_app`); err != nil {
			return err
		}
		if err := progressdb.SetSessionContext(ctx, tx, userID, roleID); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT id FROM projects ORDER BY id`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err != nil {
				return err
			}
			ids = append(ids, id)
		}
		return rows.Err()
	})
	return ids, err
}

// ============================================================
// 4. SetSessionContext + helper functions：current_user_id / is_admin / is_member
// ============================================================

func TestRBAC_RLSHelpers(t *testing.T) {
	env := setupRBACEnv(t)
	defer env.cleanup()

	ctx := context.Background()
	require.NoError(t, progressdb.InTx(ctx, env.pool, func(tx pgx.Tx) error {
		require.NoError(t, progressdb.SetSessionContext(ctx, tx, env.devID, 2))

		var cur int64
		require.NoError(t, tx.QueryRow(ctx, `SELECT current_user_id()`).Scan(&cur))
		assert.Equal(t, env.devID, cur, "current_user_id() 应返回注入的 dev id")

		var role int64
		require.NoError(t, tx.QueryRow(ctx, `SELECT current_role_id()`).Scan(&role))
		assert.Equal(t, int64(2), role)

		var admin bool
		require.NoError(t, tx.QueryRow(ctx, `SELECT is_admin()`).Scan(&admin))
		assert.False(t, admin, "dev 不应是 admin")

		var member bool
		require.NoError(t, tx.QueryRow(ctx, `SELECT is_member($1)`, env.projectID).Scan(&member))
		assert.True(t, member, "dev 是 env.projectID 的 member")

		// 非 member 项目（造一个临时 id；不存在的项目 is_member=false）
		require.NoError(t, tx.QueryRow(ctx, `SELECT is_member($1)`, int64(999999)).Scan(&member))
		assert.False(t, member, "dev 对不存在/非 member 项目 is_member=false")
		return nil
	}))

	// admin 视角：is_admin() = true
	require.NoError(t, progressdb.InTx(ctx, env.pool, func(tx pgx.Tx) error {
		require.NoError(t, progressdb.SetSessionContext(ctx, tx, env.adminID, 1))
		var admin bool
		require.NoError(t, tx.QueryRow(ctx, `SELECT is_admin()`).Scan(&admin))
		assert.True(t, admin, "admin 应是 is_admin")
		return nil
	}))
}

// ============================================================
// 5. CanTriggerEvent：admin 始终放行；dev 必须 member
// ============================================================

func TestRBAC_CanTriggerEvent(t *testing.T) {
	env := setupRBACEnv(t)
	defer env.cleanup()

	// admin 拥有 *:* 通配（含 event:E10），又是 admin → 任何项目都能触发
	ok, err := env.rbacSvc.CanTriggerEvent(context.Background(), env.adminID, 1, env.projectID, "E10")
	require.NoError(t, err)
	assert.True(t, ok, "admin 应能触发 event:E10")

	// dev 是 member 但 0001 migration 没给 dev 角色 event:E10 权限 → false（第一层就挂）
	ok, err = env.rbacSvc.CanTriggerEvent(context.Background(), env.devID, 2, env.projectID, "E10")
	require.NoError(t, err)
	assert.False(t, ok, "dev 没 event:E10 权限 → CanTriggerEvent 返回 false")

	// 加上 event:E10 perm + bind 给 role 2，再次试：dev 应能在自己 member 的项目触发
	// 注：seedLegacyRBACPerms 已 INSERT ('event','E10','all') permission row，
	// 这里改用 SELECT id + ON CONFLICT DO NOTHING 确保兼容
	ctx := context.Background()
	var permID int64
	_, err = env.pool.Exec(ctx, `
		INSERT INTO permissions (resource, action, scope) VALUES ('event', 'E10', 'all')
		ON CONFLICT (resource, action, scope) DO NOTHING
	`)
	require.NoError(t, err)
	require.NoError(t, env.pool.QueryRow(ctx, `
		SELECT id FROM permissions WHERE (resource, action, scope) = ('event', 'E10', 'all')
	`).Scan(&permID))
	_, err = env.pool.Exec(ctx, `
		INSERT INTO role_permissions (role_id, permission_id) VALUES (2, $1)
		ON CONFLICT DO NOTHING
	`, permID)
	require.NoError(t, err)

	// 重建 service（绕过缓存：本测试 cacheTTL=1ns 已经基本无缓存，但仍然显式重新读取）
	svc2, err := services.NewRBACService(services.RBACServiceDeps{
		Pool:     env.pool,
		CacheTTL: 1 * time.Nanosecond,
	})
	require.NoError(t, err)

	ok, err = svc2.CanTriggerEvent(ctx, env.devID, 2, env.projectID, "E10")
	require.NoError(t, err)
	assert.True(t, ok, "加权后 dev 在自己 member 项目能触发 E10")

	// 但 otherDev（非 member）即使有了 event:E10 角色权限，仍因第二层 member 校验被拒
	ok, err = svc2.CanTriggerEvent(ctx, env.otherDevID, 2, env.projectID, "E10")
	require.NoError(t, err)
	assert.False(t, ok, "非 member dev 必须被 member 校验拦下")
}

// ============================================================
// 6. ListPermissions / ListRoles
// ============================================================

func TestRBAC_ListPermissionsAndRoles(t *testing.T) {
	env := setupRBACEnv(t)
	defer env.cleanup()

	perms, err := env.rbacSvc.ListPermissions(context.Background())
	require.NoError(t, err)
	assert.NotEmpty(t, perms, "0001 migration 已预置若干 permissions")

	roles, err := env.rbacSvc.ListRoles(context.Background())
	require.NoError(t, err)
	// 0001 migration 预置三个系统角色
	assert.GreaterOrEqual(t, len(roles), 3)
	names := map[string]bool{}
	for _, r := range roles {
		names[r.Name] = true
	}
	assert.True(t, names["超管"] && names["开发"] && names["客服"], "三个系统角色应存在")
}
