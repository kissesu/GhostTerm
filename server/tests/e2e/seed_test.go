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

// seedTestUsers 一次性 INSERT 4 个测试用户：
//   - 1 super admin
//   - 1 customer service (cs)
//   - 2 developers (dev1, dev2)
//
// 每个用户的密码用 bcrypt MinCost 哈希；flow 测试通过 e2eEnv.{User}.Password 调登录接口。
// 注：0001 migration 已 INSERT 'admin' username 用户，e2e 用 'admin-e2e' 区分避免冲突。
func seedTestUsers(pool *pgxpool.Pool) (*seededUsers, error) {
	hash := func(pw string) ([]byte, error) {
		return bcrypt.GenerateFromPassword([]byte(pw), bcrypt.MinCost)
	}

	type spec struct {
		dst      *testUser
		username string
		name     string
		roleID   int64
		pw       string
	}

	out := &seededUsers{
		superAdmin: testUser{Username: "admin-e2e", Password: "Admin-S3cret!", Name: "Super Admin", RoleID: roleAdmin},
		cs:         testUser{Username: "cs-e2e", Password: "CS-S3cret!", Name: "Customer Service", RoleID: roleCS},
		dev1:       testUser{Username: "dev1-e2e", Password: "Dev1-S3cret!", Name: "Developer One", RoleID: roleDev},
		dev2:       testUser{Username: "dev2-e2e", Password: "Dev2-S3cret!", Name: "Developer Two", RoleID: roleDev},
	}

	specs := []spec{
		{&out.superAdmin, out.superAdmin.Username, out.superAdmin.Name, roleAdmin, out.superAdmin.Password},
		{&out.cs, out.cs.Username, out.cs.Name, roleCS, out.cs.Password},
		{&out.dev1, out.dev1.Username, out.dev1.Name, roleDev, out.dev1.Password},
		{&out.dev2, out.dev2.Username, out.dev2.Name, roleDev, out.dev2.Password},
	}

	ctx := context.Background()
	for _, s := range specs {
		h, err := hash(s.pw)
		if err != nil {
			return nil, fmt.Errorf("seed: bcrypt %s: %w", s.username, err)
		}
		var id int64
		err = pool.QueryRow(ctx, `
			INSERT INTO users (username, password_hash, display_name, role_id, is_active)
			VALUES ($1, $2, $3, $4, TRUE)
			RETURNING id
		`, s.username, h, s.name, s.roleID).Scan(&id)
		if err != nil {
			return nil, fmt.Errorf("seed: insert %s: %w", s.username, err)
		}
		s.dst.ID = id
	}

	return out, nil
}
