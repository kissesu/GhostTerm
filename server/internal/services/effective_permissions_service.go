/*
@file effective_permissions_service.go
@description 计算单个用户的"有效权限码集合"（resource:action:scope）。

业务流程：
  1. 查 users.role_id；未知 user → 返回 not found 错误
  2. 若 role_id == 1 (super_admin) → 直接返 ["*:*"] 哨兵；不读 role_permissions / user_permissions
  3. 否则查 role_permissions 拿 role 默认 grant 集合
  4. 查 user_permissions 拿 user 级 (grant + deny) 列表
  5. 返回 sort((role ∪ grants) − denies)；空集时返 [] 而非 nil

设计取舍：
  - permissions / role_permissions / user_permissions / users 四张表均未启用 RLS
    （见 0002_rls.up.sql），所以无需 InTx + SET LOCAL ROLE，pool 直查即可
  - 不做缓存：缓存职责归 Task 8 RBAC middleware；本 service 是纯计算
  - 不做 token_version 处理：那是 Task 5 的写路径职责
  - 用 map[string]struct{} 做 union：O(N+M+K)，super_admin 短路避免 DB
  - sort.Strings 让结果确定性可比对，便于上层缓存键 / 测试断言
  - DB 层 user_permissions PRIMARY KEY (user_id, permission_id) 已保证不会出现
    "同 perm 同时 grant+deny"；service 不需要再做仲裁

@author Atlas.oi
@date 2026-05-02
*/

package services

import (
	"context"
	"errors"
	"fmt"
	"sort"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SuperAdminRoleID 是超管角色的固定 id（0001 migration 预置 + 0007 部分唯一索引兜底）。
const SuperAdminRoleID int64 = 1

// EffectivePermissionsService 计算单个用户的有效权限码集合。
//
// "有效"定义见 plan §6 / spec：
//   - super_admin → ["*:*"] 哨兵
//   - 其余用户 → (role grants ∪ user grants) − user denies，去重排序
type EffectivePermissionsService interface {
	// Compute 返回 userID 的有效权限码列表（resource:action:scope，已去重并 ASC 排序）。
	//
	// 错误：
	//   - userID 不存在 → 包含 "not found"
	//   - DB 失败 → 透传（%w 包裹）
	Compute(ctx context.Context, userID int64) ([]string, error)
}

// effectivePermissionsService 是 EffectivePermissionsService 的具体实现。
type effectivePermissionsService struct {
	pool *pgxpool.Pool
}

// 编译时校验
var _ EffectivePermissionsService = (*effectivePermissionsService)(nil)

// NewEffectivePermissionsService 构造 EffectivePermissionsService。
func NewEffectivePermissionsService(pool *pgxpool.Pool) EffectivePermissionsService {
	return &effectivePermissionsService{pool: pool}
}

// Compute 见 EffectivePermissionsService.Compute。
func (s *effectivePermissionsService) Compute(ctx context.Context, userID int64) ([]string, error) {
	// 1. 查 role_id
	var roleID int64
	err := s.pool.QueryRow(ctx, `SELECT role_id FROM users WHERE id = $1`, userID).Scan(&roleID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("effective_permissions: user %d: %w", userID, ErrUserNotFound)
		}
		return nil, fmt.Errorf("effective_permissions: query role: %w", err)
	}

	// 2. 超管短路：直接返哨兵，不再读任何权限表（决策 #0.5 / 0007 trigger 也保证两表无超管行）
	if roleID == SuperAdminRoleID {
		return []string{"*:*"}, nil
	}

	// 3. role 默认 grant 集合
	rolePerms, err := s.queryRolePermissions(ctx, roleID)
	if err != nil {
		return nil, err
	}

	// 4. user 级覆写
	grants, denies, err := s.queryUserOverrides(ctx, userID)
	if err != nil {
		return nil, err
	}

	// 5. (role ∪ grants) − denies
	set := make(map[string]struct{}, len(rolePerms)+len(grants))
	for _, p := range rolePerms {
		set[p] = struct{}{}
	}
	for _, p := range grants {
		set[p] = struct{}{}
	}
	for _, p := range denies {
		delete(set, p)
	}

	// 输出始终为非 nil 切片（即使为空），让 handler 直接 JSON 序列化为 []
	out := make([]string, 0, len(set))
	for p := range set {
		out = append(out, p)
	}
	sort.Strings(out)
	return out, nil
}

// queryRolePermissions 读取 role_id 绑定的全部权限码（resource:action:scope）。
func (s *effectivePermissionsService) queryRolePermissions(ctx context.Context, roleID int64) ([]string, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT p.resource || ':' || p.action || ':' || p.scope
		FROM role_permissions rp
		JOIN permissions p ON p.id = rp.permission_id
		WHERE rp.role_id = $1
	`, roleID)
	if err != nil {
		return nil, fmt.Errorf("effective_permissions: query role permissions: %w", err)
	}
	defer rows.Close()

	var out []string
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			return nil, fmt.Errorf("effective_permissions: scan role permission: %w", err)
		}
		out = append(out, code)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("effective_permissions: iterate role permissions: %w", err)
	}
	return out, nil
}

// queryUserOverrides 读取 userID 的 user_permissions，分别返回 grants / denies 切片。
//
// 业务背景：user_permissions PRIMARY KEY (user_id, permission_id) 保证同 (user, perm)
// 至多一行；所以一行只会落到 grants 或 denies 中之一。
func (s *effectivePermissionsService) queryUserOverrides(ctx context.Context, userID int64) (grants, denies []string, err error) {
	rows, err := s.pool.Query(ctx, `
		SELECT p.resource || ':' || p.action || ':' || p.scope, up.effect
		FROM user_permissions up
		JOIN permissions p ON p.id = up.permission_id
		WHERE up.user_id = $1
	`, userID)
	if err != nil {
		return nil, nil, fmt.Errorf("effective_permissions: query user overrides: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			code   string
			effect string
		)
		if err := rows.Scan(&code, &effect); err != nil {
			return nil, nil, fmt.Errorf("effective_permissions: scan user override: %w", err)
		}
		switch effect {
		case "grant":
			grants = append(grants, code)
		case "deny":
			denies = append(denies, code)
		default:
			// permission_effect ENUM 仅 grant/deny 两值，DB 已保证；落到这里说明 schema 漂移
			return nil, nil, fmt.Errorf("effective_permissions: unknown effect %q for user %d perm %s", effect, userID, code)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("effective_permissions: iterate user overrides: %w", err)
	}
	return grants, denies, nil
}
