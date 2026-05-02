/*
@file permissions_service.go
@description PermissionsService 提供 Atlas "权限管理" 后台需要的 4 个写/读 action：
             - ListRolePermissions(roleID)               读取某 role 当前 grants
             - UpdateRolePermissions(roleID, ids)        PUT 全量替换 role grants
             - ListUserOverrides(userID)                 读取某 user 当前 grant/deny 覆写
             - UpdateUserOverrides(userID, overrides)    PUT 全量替换 user 覆写

业务流程（写路径）：
  1. 应用层先做超管校验（roleID == 1 / target user.role_id == 1 → 立即拒绝）
  2. 事务内 DELETE 旧集合 → INSERT 新集合
  3. 同事务 UPDATE users.token_version + 1
     - role 写：所有 role_id == 该 role 的用户都 +1
     - user 写：仅该 user +1
     这一步是"即时生效"的关键：旧 access token 下次 API 调用必 401，
     前端 silent refresh 后新 token 就装着新权限码。

设计取舍：
  - super_admin 校验放在 service 层：handler 拿到的错误就是友好分类（ErrSuperAdminImmutable
    映射 422），而不是 PG check_violation 字符串。0007 的 trigger 仍是兜底，service 提前
    返回避免无谓 round trip。
  - PUT 全量替换（DELETE + INSERT）而非 diff：admin 端低频写，简单可审计；
    diff 引入"哪些是新增/删除"额外状态，且 PRIMARY KEY 已能保证幂等。
  - 不引入缓存：handler 层（或 RBAC middleware）若需缓存自行处理；本 service 是纯写。
  - permissions/role_permissions/user_permissions/users 四表均未启用 RLS
    （见 0002_rls.up.sql），所以无需 SetSessionContext + SET LOCAL ROLE，
    用 progressdb.InTx 直接事务即可。

@author Atlas.oi
@date 2026-05-02
*/

package services

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	progressdb "github.com/ghostterm/progress-server/internal/db"
)

// ============================================================
// 哨兵错误（handler 层据此映射 HTTP status）
// ============================================================

// ErrSuperAdminImmutable 任何对超管 (role_id=1) 的权限写入都用此错误拒绝。
// handler 层映射为 422 Unprocessable Entity（业务规则违反，不是请求格式问题）。
var ErrSuperAdminImmutable = errors.New("permissions: cannot modify super_admin")

// ErrRoleNotFound 写 role permissions 时 roleID 在 roles 表不存在。
var ErrRoleNotFound = errors.New("permissions: role not found")

// ErrInvalidEffect user override 的 effect 非 grant/deny 时返回。
var ErrInvalidEffect = errors.New("permissions: effect must be 'grant' or 'deny'")

// 注：ErrUserNotFound 已在 user_service.go 中定义，本文件不重复声明。

// ============================================================
// 视图模型
// ============================================================
//
// 注意：Permission 类型已在 interfaces.go 中定义（RBACService.ListPermissions 复用）。
// 字段（ID/Resource/Action/Scope）与本服务 0007 schema 完全对齐，不重复声明。
// 其 Code() 返回 2 段（resource:action）——是历史接口语义，本服务返回 Permission 时
// caller（Task 7 handler）若需要 3 段码需自行拼 scope，避免改动既有 Code() 破坏
// rbac_service_test.go 的契约。

// UserOverride 用户覆写一条记录：哪个 perm + grant 还是 deny。
//
// 业务背景：UI 编辑时按 (permission_id, effect) 提交；scope/action 信息在前端通过
// permissions 字典查表展示，service 层只关心 id + effect。
type UserOverride struct {
	PermissionID int64
	Effect       string // "grant" | "deny"
}

// ============================================================
// 接口
// ============================================================

// PermissionsService 管理 role_permissions 与 user_permissions 的全量替换写入，
// 同时负责 token_version bump 让权限变更"立即生效"。
//
// actorID 参数：仅 user_permissions.created_by 列需要（审计字段）；
// role_permissions 表无 created_by 列，actorID 仅用于将来扩展（如审计 log）。
type PermissionsService interface {
	// ListRolePermissions 返回 roleID 当前持有的全部 permission 详情。
	// 未知 roleID（包括 super_admin）返回空切片，不报错。
	ListRolePermissions(ctx context.Context, roleID int64) ([]Permission, error)

	// UpdateRolePermissions 全量替换 roleID 的 grants：
	//   1. roleID == 1 (super_admin) → ErrSuperAdminImmutable
	//   2. roleID 不存在 → ErrRoleNotFound
	//   3. 事务内 DELETE 旧 + INSERT 新 + bump 该 role 全部用户的 token_version
	//
	// permissionIDs 为空时仅 DELETE，不 INSERT；token_version 仍 bump（清空也是变更）。
	UpdateRolePermissions(ctx context.Context, roleID int64, permissionIDs []int64, actorID int64) error

	// ListUserOverrides 返回 userID 当前的 user_permissions 覆写列表。
	// userID 不存在 → ErrUserNotFound。
	ListUserOverrides(ctx context.Context, userID int64) ([]UserOverride, error)

	// UpdateUserOverrides 全量替换 userID 的 overrides：
	//   1. userID 不存在 → ErrUserNotFound
	//   2. user.role_id == 1 (super_admin) → ErrSuperAdminImmutable
	//   3. 任何 effect 非 grant/deny → ErrInvalidEffect（DB 写之前校验）
	//   4. 事务内 DELETE 旧 + INSERT 新 + bump 该 user token_version
	UpdateUserOverrides(ctx context.Context, userID int64, overrides []UserOverride, actorID int64) error
}

// ============================================================
// 实现
// ============================================================

// permissionsService 是 PermissionsService 的具体实现。
type permissionsService struct {
	pool *pgxpool.Pool
}

// 编译时校验
var _ PermissionsService = (*permissionsService)(nil)

// NewPermissionsService 构造 PermissionsService。
func NewPermissionsService(pool *pgxpool.Pool) PermissionsService {
	return &permissionsService{pool: pool}
}

// ----------------------------------------------------------
// ListRolePermissions
// ----------------------------------------------------------

func (s *permissionsService) ListRolePermissions(ctx context.Context, roleID int64) ([]Permission, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT p.id, p.resource, p.action, p.scope
		FROM role_permissions rp
		JOIN permissions p ON p.id = rp.permission_id
		WHERE rp.role_id = $1
		ORDER BY p.resource, p.action, p.scope
	`, roleID)
	if err != nil {
		return nil, fmt.Errorf("permissions: query role permissions: %w", err)
	}
	defer rows.Close()

	out := make([]Permission, 0)
	for rows.Next() {
		var p Permission
		if err := rows.Scan(&p.ID, &p.Resource, &p.Action, &p.Scope); err != nil {
			return nil, fmt.Errorf("permissions: scan role permission: %w", err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("permissions: iterate role permissions: %w", err)
	}
	return out, nil
}

// ----------------------------------------------------------
// UpdateRolePermissions
// ----------------------------------------------------------

func (s *permissionsService) UpdateRolePermissions(ctx context.Context, roleID int64, permissionIDs []int64, actorID int64) error {
	// 1. 服务层超管拦截：早返回，避免触达 DB trigger
	if roleID == SuperAdminRoleID {
		return ErrSuperAdminImmutable
	}

	// 2. 验证 roleID 存在（避免给不存在的 role 写入）
	var exists bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM roles WHERE id = $1)`, roleID).Scan(&exists)
	if err != nil {
		return fmt.Errorf("permissions: check role exists: %w", err)
	}
	if !exists {
		return ErrRoleNotFound
	}

	// 3. 事务：DELETE 旧 + INSERT 新 + bump token_version
	return progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM role_permissions WHERE role_id = $1`, roleID); err != nil {
			return fmt.Errorf("permissions: delete role permissions: %w", err)
		}

		if len(permissionIDs) > 0 {
			// 批量 INSERT：构造 (role_id, permission_id) 多 VALUES
			// 不用 pgx.Batch 以保证整组 INSERT 共享同一事务的失败语义清晰
			args := make([]any, 0, len(permissionIDs)*2)
			placeholders := ""
			for i, pid := range permissionIDs {
				if i > 0 {
					placeholders += ","
				}
				placeholders += fmt.Sprintf("($%d, $%d)", i*2+1, i*2+2)
				args = append(args, roleID, pid)
			}
			q := "INSERT INTO role_permissions (role_id, permission_id) VALUES " + placeholders
			if _, err := tx.Exec(ctx, q, args...); err != nil {
				return fmt.Errorf("permissions: insert role permissions: %w", err)
			}
		}

		// 4. bump：该 role 下所有用户的 token_version + 1
		// 即使没有用户绑此 role，UPDATE 0 行也是合法 no-op
		if _, err := tx.Exec(ctx, `
			UPDATE users SET token_version = token_version + 1
			WHERE role_id = $1
		`, roleID); err != nil {
			return fmt.Errorf("permissions: bump token_version for role users: %w", err)
		}
		return nil
	})
}

// ----------------------------------------------------------
// ListUserOverrides
// ----------------------------------------------------------

func (s *permissionsService) ListUserOverrides(ctx context.Context, userID int64) ([]UserOverride, error) {
	// 验证 user 存在；否则空表 vs 不存在 user 上层无法区分
	var exists bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)`, userID).Scan(&exists)
	if err != nil {
		return nil, fmt.Errorf("permissions: check user exists: %w", err)
	}
	if !exists {
		return nil, ErrUserNotFound
	}

	rows, err := s.pool.Query(ctx, `
		SELECT permission_id, effect::text
		FROM user_permissions
		WHERE user_id = $1
		ORDER BY permission_id
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("permissions: query user overrides: %w", err)
	}
	defer rows.Close()

	out := make([]UserOverride, 0)
	for rows.Next() {
		var o UserOverride
		if err := rows.Scan(&o.PermissionID, &o.Effect); err != nil {
			return nil, fmt.Errorf("permissions: scan user override: %w", err)
		}
		out = append(out, o)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("permissions: iterate user overrides: %w", err)
	}
	return out, nil
}

// ----------------------------------------------------------
// UpdateUserOverrides
// ----------------------------------------------------------

func (s *permissionsService) UpdateUserOverrides(ctx context.Context, userID int64, overrides []UserOverride, actorID int64) error {
	// 1. 校验 effect 合法性（不要等 DB ENUM 报错才发现）
	for _, o := range overrides {
		if o.Effect != "grant" && o.Effect != "deny" {
			return fmt.Errorf("%w: got %q", ErrInvalidEffect, o.Effect)
		}
	}

	// 2. 验证 user 存在 + 拿 role_id（一次查询完成）
	var roleID int64
	err := s.pool.QueryRow(ctx, `SELECT role_id FROM users WHERE id = $1`, userID).Scan(&roleID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrUserNotFound
		}
		return fmt.Errorf("permissions: lookup user role: %w", err)
	}

	// 3. 服务层超管拦截
	if roleID == SuperAdminRoleID {
		return ErrSuperAdminImmutable
	}

	// 4. 事务：DELETE 旧 + INSERT 新 + bump token_version
	return progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM user_permissions WHERE user_id = $1`, userID); err != nil {
			return fmt.Errorf("permissions: delete user overrides: %w", err)
		}

		if len(overrides) > 0 {
			// 批量 INSERT：(user_id, permission_id, effect, created_by)
			// effect 走 ENUM cast 让 DB 层做最后一道防护
			args := make([]any, 0, len(overrides)*4)
			placeholders := ""
			for i, o := range overrides {
				if i > 0 {
					placeholders += ","
				}
				base := i * 4
				placeholders += fmt.Sprintf("($%d, $%d, $%d::permission_effect, $%d)", base+1, base+2, base+3, base+4)
				args = append(args, userID, o.PermissionID, o.Effect, actorID)
			}
			q := "INSERT INTO user_permissions (user_id, permission_id, effect, created_by) VALUES " + placeholders
			if _, err := tx.Exec(ctx, q, args...); err != nil {
				return fmt.Errorf("permissions: insert user overrides: %w", err)
			}
		}

		// 5. bump 单 user token_version
		if _, err := tx.Exec(ctx, `
			UPDATE users SET token_version = token_version + 1
			WHERE id = $1
		`, userID); err != nil {
			return fmt.Errorf("permissions: bump token_version for user: %w", err)
		}
		return nil
	})
}
