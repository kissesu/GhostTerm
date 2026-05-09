// @file truncate.go
// @description services 包共享 postgres 容器模式下的"清表 + 保留 seed"helper。
//
// 业务背景：
//   原模式每个测试自起 docker 容器（per-test isolation），CI 在 services 包 130+ 测试串行
//   起容器超出 120s 预算。改为 services 包级别 TestMain 共享单容器后，每个测试结束需要
//   把数据库还原到 0001 seed 状态，避免 fixture 间数据污染。
//
//   方案选择：
//     - 业务表（feedbacks/payments/projects/files/...）TRUNCATE ... RESTART IDENTITY CASCADE
//     - users 表：DELETE WHERE id != 1（保留 0001 seed 的 admin，role_id=1 受
//       0007 users_super_admin_unique 约束至多一行，重 INSERT 会破约束）
//     - roles/permissions/role_permissions：不动（0001 INSERT 的 system seed，
//       测试不应修改；rbac/permissions service 测试均未 INSERT 新 row）
//
//   性能预期：单次 TRUNCATE CASCADE ≈ 5-10ms，比 dockertest 启容器 5-15s 快 1000x；
//   services 包 ~130 测试从 120s+ 降到 30-60s。
//
// @author Atlas.oi
// @date 2026-05-09

package testutil

import (
	"context"
	"fmt"
	"sync"

	"github.com/jackc/pgx/v5/pgxpool"
)

// rolePermRow 是 role_permissions seed 快照的单行数据。
type rolePermRow struct {
	RoleID, PermissionID int64
}

// rolePermSeed 缓存 0001 migration 写入的 role_permissions seed 数据。
//
// 业务背景：services 测试（如 UpdateRolePermissions_ReplacesAllGrants）会改写 role_permissions，
// 共享 pool 模式下若不还原 seed，下一个测试拿到的就是被前面测试改坏的状态。
// 启动时拍一次快照，每次 TruncateAndReseed 后还原。
//
// 单 SetSharedPool 调用对应单 capture：sync.Once 防 TestMain 重入时重复拍。
var (
	rolePermSeed     []rolePermRow
	rolePermSeedOnce sync.Once
)

// CaptureSeed 在 sharedPool 注入后第一次调用时拍快照。
//
// 业务流程：从 role_permissions SELECT 全部行存入内存。要求调用时机是 0001 seed 已就位、
// 任何业务测试尚未运行（避免拍到污染状态）。services TestMain 起容器跑完 migration 即满足。
func CaptureSeed(ctx context.Context, pool *pgxpool.Pool) error {
	var capErr error
	rolePermSeedOnce.Do(func() {
		rows, err := pool.Query(ctx, "SELECT role_id, permission_id FROM role_permissions ORDER BY role_id, permission_id")
		if err != nil {
			capErr = fmt.Errorf("query role_permissions: %w", err)
			return
		}
		defer rows.Close()
		var out []rolePermRow
		for rows.Next() {
			var r rolePermRow
			if err := rows.Scan(&r.RoleID, &r.PermissionID); err != nil {
				capErr = fmt.Errorf("scan role_permissions: %w", err)
				return
			}
			out = append(out, r)
		}
		if err := rows.Err(); err != nil {
			capErr = fmt.Errorf("iter role_permissions: %w", err)
			return
		}
		rolePermSeed = out
	})
	return capErr
}

// businessTables 是每次测试结束需要清空的业务/动态表清单。
//
// 维护规则：新增 migration 加表时如果表是"测试会 INSERT 业务数据"的，必须加进此清单；
// 否则会跨测试污染。系统 seed 表（roles/permissions/role_permissions）不要加，
// users 走单独的 DELETE 路径不在此清单。
//
// 顺序无关：TRUNCATE ... CASCADE 自动处理 FK 依赖。
var businessTables = []string{
	"feedbacks", "feedback_attachments",
	"payments", "payment_attachments",
	"quote_change_logs", "status_change_logs",
	"project_files", "thesis_versions",
	"project_members", "project_developers",
	"projects", "files",
	"notifications", "ws_tickets",
	"refresh_tokens",
	"user_permissions",
	"security_audit_log",
}

// TruncateAndReseed 把数据库还原到 0001 seed 状态：清空所有业务表，删非 admin 用户。
//
// 业务流程：
//  1. TRUNCATE 业务表 RESTART IDENTITY CASCADE —— 清数据 + 重置序列 + 自动 cascade FK
//  2. DELETE FROM users WHERE id != 1 —— 保留 admin（0001 seed），清测试创建的用户
//  3. 重置 users_id_seq 让下次 INSERT 从 2 起，避免测试间 id 漂移
//
// 失败语义：任一步出错返回 error，调用方（StartPostgres fast path）应 t.Fatalf
// 终止测试 —— 脏 DB 状态会导致后续测试假性失败，必须 fail-fast。
func TruncateAndReseed(ctx context.Context, pool *pgxpool.Pool) error {
	stmt := "TRUNCATE TABLE "
	for i, t := range businessTables {
		if i > 0 {
			stmt += ", "
		}
		stmt += t
	}
	stmt += " RESTART IDENTITY CASCADE"

	if _, err := pool.Exec(ctx, stmt); err != nil {
		return fmt.Errorf("truncate business tables: %w", err)
	}

	// users 表 hybrid（admin seed + 测试 INSERT），用 DELETE 而非 TRUNCATE
	if _, err := pool.Exec(ctx, "DELETE FROM users WHERE id != 1"); err != nil {
		return fmt.Errorf("delete non-admin users: %w", err)
	}

	// 重置 sequence 防 id 漂移影响测试断言；admin 占 id=1，下次 INSERT 应从 2 起
	if _, err := pool.Exec(ctx, "SELECT setval(pg_get_serial_sequence('users', 'id'), 1, true)"); err != nil {
		return fmt.Errorf("reset users id sequence: %w", err)
	}

	// 还原 role_permissions seed —— 测试可能 UpdateRolePermissions 改写过它，
	// 必须用启动时拍的快照重写。user_permissions 已被业务表清单 TRUNCATE 清空（0007 默认空 seed）。
	if len(rolePermSeed) > 0 {
		if _, err := pool.Exec(ctx, "DELETE FROM role_permissions"); err != nil {
			return fmt.Errorf("delete role_permissions: %w", err)
		}
		// 用 unnest 一次 batch INSERT，比 N 次 Exec 快
		roleIDs := make([]int64, len(rolePermSeed))
		permIDs := make([]int64, len(rolePermSeed))
		for i, r := range rolePermSeed {
			roleIDs[i] = r.RoleID
			permIDs[i] = r.PermissionID
		}
		if _, err := pool.Exec(ctx,
			`INSERT INTO role_permissions (role_id, permission_id)
			 SELECT * FROM unnest($1::bigint[], $2::bigint[])`,
			roleIDs, permIDs); err != nil {
			return fmt.Errorf("reseed role_permissions: %w", err)
		}
	}

	return nil
}
