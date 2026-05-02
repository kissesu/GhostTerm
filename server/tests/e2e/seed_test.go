/*
@file seed.go
@description 测试用户 seed 工具：在 e2e Postgres 中预置 4 个固定用户，
             供 flow_*_test.go 各自登录使用。

             业务背景：
             - 0001 migration 已预置 3 个角色（admin=1, dev=2, cs=3）
             - 用 bcrypt MinCost(=4) 让 hash<1ms，避免 4 用户 seed 拖慢启动
             - username / 密码固定，flow 测试只需引用 testUser 结构
             - 用户明确指令覆盖 spec §4：账号字段使用 username 而非 email

@author Atlas.oi
@date 2026-04-29
*/

package e2e

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

// testUser 是 e2e 中一个固定测试用户的元数据。
//
// 字段：
//   - ID:     seed 后的 users.id
//   - RoleID: 1=admin / 2=dev / 3=cs（与 migration 0001 对齐）
//   - Username / Password: 登录凭据，固定常量便于 flow 测试断言
type testUser struct {
	ID       int64
	RoleID   int64
	Username string
	Password string
	Name     string
}

// seededUsers 是 setup() 调用 seedTestUsers 后返回的固定用户集合。
type seededUsers struct {
	superAdmin testUser
	cs         testUser
	dev1       testUser
	dev2       testUser
}

// 角色 ID 常量（与 migration 0001 INSERT 对齐）。
const (
	roleAdmin int64 = 1
	roleDev   int64 = 2
	roleCS    int64 = 3
)

// seedTestUsers 一次性配置 4 个固定测试用户：
//   - 1 super admin（复用 0001 migration 已 INSERT 的 'admin' 用户，仅 UPDATE 密码 hash）
//   - 1 customer service (cs)
//   - 2 developers (dev1, dev2)
//
// 每个用户的密码用 bcrypt MinCost 哈希；flow 测试通过 e2eEnv.{User}.Password 调登录接口。
//
// 业务背景：
//   - 0007 migration 引入 users_super_admin_unique 部分唯一索引，全表至多一行 role_id=1。
//     不能再 INSERT 新 super_admin（即使 username 不冲突也会撞 partial unique index）。
//   - 0001 migration 已预置 username='admin' (role_id=1)，本 helper 改为 UPDATE 它的
//     password_hash + display_name 复用，并保留固定的 e2e Password 让 flow 测试可登录。
//   - cs / dev1 / dev2 仍走 INSERT（普通角色无唯一性约束）。
func seedTestUsers(pool *pgxpool.Pool) (*seededUsers, error) {
	hash := func(pw string) ([]byte, error) {
		return bcrypt.GenerateFromPassword([]byte(pw), bcrypt.MinCost)
	}

	out := &seededUsers{
		// 注：username 改用 'admin'（与 0001 migration 已 INSERT 的用户名一致），
		// password 仍是 e2e 自定义的固定值，下面 UPDATE 把 hash 同步上去
		superAdmin: testUser{Username: "admin", Password: "Admin-S3cret!", Name: "Super Admin", RoleID: roleAdmin},
		cs:         testUser{Username: "cs-e2e", Password: "CS-S3cret!", Name: "Customer Service", RoleID: roleCS},
		dev1:       testUser{Username: "dev1-e2e", Password: "Dev1-S3cret!", Name: "Developer One", RoleID: roleDev},
		dev2:       testUser{Username: "dev2-e2e", Password: "Dev2-S3cret!", Name: "Developer Two", RoleID: roleDev},
	}

	ctx := context.Background()

	// 1. super_admin：UPDATE 0001 已 INSERT 的 'admin' 行，让 e2e 能用固定密码登录
	saHash, err := hash(out.superAdmin.Password)
	if err != nil {
		return nil, fmt.Errorf("seed: bcrypt admin: %w", err)
	}
	var saID int64
	err = pool.QueryRow(ctx, `
		UPDATE users SET password_hash = $1, display_name = $2, is_active = TRUE
		WHERE role_id = 1
		RETURNING id
	`, saHash, out.superAdmin.Name).Scan(&saID)
	if err != nil {
		return nil, fmt.Errorf("seed: update admin: %w", err)
	}
	out.superAdmin.ID = saID

	// 2. cs / dev1 / dev2：普通角色直接 INSERT
	type spec struct {
		dst    *testUser
		pw     string
		uname  string
		name   string
		roleID int64
	}
	specs := []spec{
		{&out.cs, out.cs.Password, out.cs.Username, out.cs.Name, roleCS},
		{&out.dev1, out.dev1.Password, out.dev1.Username, out.dev1.Name, roleDev},
		{&out.dev2, out.dev2.Password, out.dev2.Username, out.dev2.Name, roleDev},
	}
	for _, s := range specs {
		h, err := hash(s.pw)
		if err != nil {
			return nil, fmt.Errorf("seed: bcrypt %s: %w", s.uname, err)
		}
		var id int64
		err = pool.QueryRow(ctx, `
			INSERT INTO users (username, password_hash, display_name, role_id, is_active)
			VALUES ($1, $2, $3, $4, TRUE)
			RETURNING id
		`, s.uname, h, s.name, s.roleID).Scan(&id)
		if err != nil {
			return nil, fmt.Errorf("seed: insert %s: %w", s.uname, err)
		}
		s.dst.ID = id
	}

	// 3. 旧权限码补丁（v1 handler 依然依赖这套码，Task 5/8 之后可移除）
	if err := seedLegacyPermissions(pool); err != nil {
		return nil, fmt.Errorf("seed: legacy perms: %w", err)
	}

	return out, nil
}

// seedLegacyPermissions 给 e2e 容器补回 v1 handler 仍在使用的旧权限码。
//
// 业务背景：
//   - 0007 migration 已 TRUNCATE permissions + role_permissions 并按新模型
//     (nav/progress/users/permissions) 重新种子；
//   - 但 handler 层（feedback / quote / payment / project 等）当前仍用旧码
//     (feedback:read / feedback:create / project:create / payment:create / event:E* …)，
//     Task 5/8 之后才会切到 EffectivePermissionsService + 新码；
//   - 在过渡期，e2e 端到端 flow 必须能让 cs/dev 角色用旧码通过权限校验，
//     否则所有 POST 类 flow 都会被 RBAC 中间件拦下返回 422 "无 X 权限"。
//   - 通配 ('*','*','all') 给 role_id=1（trigger 阻断超管 INSERT，需先 DISABLE）。
func seedLegacyPermissions(pool *pgxpool.Pool) error {
	ctx := context.Background()

	// 1. 旧 permissions 行（含通配 + 全部 v1 handler 引用的码）
	_, err := pool.Exec(ctx, `
		INSERT INTO permissions (resource, action, scope) VALUES
			('project',  'read',     'member'),
			('project',  'update',   'member'),
			('project',  'create',   'all'),
			('project',  'delete',   'all'),
			('feedback', 'read',     'member'),
			('feedback', 'create',   'member'),
			('payment',  'read',     'member'),
			('payment',  'create',   'member'),
			('quote',    'change',   'member'),
			('thesis',   'upload',   'member'),
			('thesis',   'read',     'member'),
			('file',     'read',     'member'),
			('file',     'upload',   'all'),
			('event',    'E0',       'all'),
			('event',    'E1',       'all'),
			('event',    'E2',       'all'),
			('event',    'E3',       'all'),
			('event',    'E4',       'all'),
			('event',    'E5',       'all'),
			('event',    'E6',       'all'),
			('event',    'E7',       'all'),
			('event',    'E8',       'all'),
			('event',    'E9',       'all'),
			('event',    'E10',      'all'),
			('event',    'E11',      'all'),
			('event',    'E12',      'all'),
			('event',    'E13',      'all'),
			('*',        '*',        'all')
		ON CONFLICT (resource, action, scope) DO NOTHING
	`)
	if err != nil {
		return fmt.Errorf("legacy perms: insert permissions: %w", err)
	}

	// 2. 给 role 2 (dev) 绑定旧 dev 集合（除 project:create / project:delete / 通配）
	_, err = pool.Exec(ctx, `
		INSERT INTO role_permissions (role_id, permission_id)
			SELECT 2, id FROM permissions
			WHERE (resource, action, scope) IN (
				('project',  'read',     'member'),
				('project',  'update',   'member'),
				('feedback', 'read',     'member'),
				('feedback', 'create',   'member'),
				('payment',  'read',     'member'),
				('payment',  'create',   'member'),
				('thesis',   'upload',   'member'),
				('thesis',   'read',     'member'),
				('file',     'read',     'member'),
				('file',     'upload',   'all')
			)
		ON CONFLICT DO NOTHING
	`)
	if err != nil {
		return fmt.Errorf("legacy perms: bind dev: %w", err)
	}

	// 3. 给 role 3 (cs) 绑定旧 cs 集合（cs 是项目主对接人，含 project:create / quote:change / event:E*）
	_, err = pool.Exec(ctx, `
		INSERT INTO role_permissions (role_id, permission_id)
			SELECT 3, id FROM permissions
			WHERE (resource = 'event')
			   OR (resource, action, scope) IN (
				('project',  'read',     'member'),
				('project',  'update',   'member'),
				('project',  'create',   'all'),
				('feedback', 'read',     'member'),
				('feedback', 'create',   'member'),
				('payment',  'read',     'member'),
				('payment',  'create',   'member'),
				('quote',    'change',   'member'),
				('thesis',   'upload',   'member'),
				('thesis',   'read',     'member'),
				('file',     'read',     'member'),
				('file',     'upload',   'all')
			)
		ON CONFLICT DO NOTHING
	`)
	if err != nil {
		return fmt.Errorf("legacy perms: bind cs: %w", err)
	}

	// 4. 给 role 1 (super_admin) 绑定通配；trigger 阻断 → 临时 DISABLE 后再 ENABLE
	if _, err = pool.Exec(ctx,
		`ALTER TABLE role_permissions DISABLE TRIGGER prevent_super_admin_role_permission_write`); err != nil {
		return fmt.Errorf("legacy perms: disable trigger: %w", err)
	}
	defer func() {
		_, _ = pool.Exec(ctx,
			`ALTER TABLE role_permissions ENABLE TRIGGER prevent_super_admin_role_permission_write`)
	}()
	_, err = pool.Exec(ctx, `
		INSERT INTO role_permissions (role_id, permission_id)
			SELECT 1, id FROM permissions WHERE (resource, action, scope) = ('*', '*', 'all')
		ON CONFLICT DO NOTHING
	`)
	if err != nil {
		return fmt.Errorf("legacy perms: bind super_admin wildcard: %w", err)
	}

	return nil
}
