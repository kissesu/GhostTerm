/*
@file rbac_service.go
@description RBACService 的具体实现：
             - HasPermission：role_permissions ⨝ permissions 查询，roleID→permset 5min 内存缓存
             - CanTriggerEvent：HasPermission(role, "event:E10") + admin 或 project_members 校验
             - VisibilityFilter：RLS 已承担行级可见性，恒返回 "TRUE"（保留接口 future-proof）
             - ListPermissions / ListRoles / LoadUserPermissions：给管理 UI 与 /api/auth/me 用

             权限码约定：
             - "<resource>:<action>"，例如 "project:read" / "customer:create" / "event:E10"
             - 通配 "*:*" 视为超管（0001 migration 预置）
             - HasPermission 命中"通配"或"resource:action 完全等同"则放行

             缓存策略（spec §5）：
             - sync.Map[roleID]→cacheEntry{perms, expireAt}
             - 命中且未过期：直接返回；过期或缺失：DB 查询后回填
             - 5 min TTL —— 与 access token TTL 量级一致，权限新增/收回的延迟容忍
             - 可由 InvalidateRole / InvalidateAll 主动失效（管理 UI 改权限后调用）
@author Atlas.oi
@date 2026-04-29
*/

package services

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// RBACServiceDeps 装配 NewRBACService 所需依赖。
type RBACServiceDeps struct {
	Pool     *pgxpool.Pool
	CacheTTL time.Duration // 默认 5 分钟，测试可注 0 关闭缓存
}

// rbacService 是 RBACService 的具体实现。
type rbacService struct {
	pool     *pgxpool.Pool
	cacheTTL time.Duration

	// roleID → cacheEntry，全角色共享一个 sync.Map
	cache sync.Map
}

// cacheEntry 是单个 roleID 的缓存项。
type cacheEntry struct {
	perms    map[string]bool
	expireAt time.Time
}

// 编译时校验
var _ RBACService = (*rbacService)(nil)

// NewRBACService 构造 RBACService。
//
// CacheTTL <= 0 时使用默认 5 分钟；显式传 1ns 也算关闭缓存（每次都查 DB）。
func NewRBACService(deps RBACServiceDeps) (RBACService, error) {
	if deps.Pool == nil {
		return nil, errors.New("rbac_service: pool is required")
	}
	ttl := deps.CacheTTL
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}
	return &rbacService{
		pool:     deps.Pool,
		cacheTTL: ttl,
	}, nil
}

// ============================================================
// 缓存读写
// ============================================================

// loadPermsFromCache 从缓存读 roleID 的权限码集合，未命中或过期返回 nil。
func (s *rbacService) loadPermsFromCache(roleID int64) map[string]bool {
	v, ok := s.cache.Load(roleID)
	if !ok {
		return nil
	}
	entry, ok := v.(cacheEntry)
	if !ok || time.Now().After(entry.expireAt) {
		return nil
	}
	return entry.perms
}

// storePermsToCache 把 roleID 的权限集合写入缓存。
func (s *rbacService) storePermsToCache(roleID int64, perms map[string]bool) {
	s.cache.Store(roleID, cacheEntry{
		perms:    perms,
		expireAt: time.Now().Add(s.cacheTTL),
	})
}

// InvalidateRole 失效某 roleID 的缓存（管理 UI 改权限后调用）。
//
// 注：未在 RBACService interface 中声明 —— 这是实现细节，由组合 service 直接持引用使用。
func (s *rbacService) InvalidateRole(roleID int64) {
	s.cache.Delete(roleID)
}

// loadPermsFromDB 从 DB 读 roleID 的权限集合（含通配 "*:*"），并按 code 装入 map。
//
// 业务流程：
//  1. 查 role_permissions ⨝ permissions WHERE role_id=$1
//  2. 拼接 "<resource>:<action>" 作为 code 键，true 作为值
//  3. 通配 "*:*" 也以原样存入；HasPermission 单独检测它
func (s *rbacService) loadPermsFromDB(ctx context.Context, roleID int64) (map[string]bool, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT p.resource, p.action
		FROM role_permissions rp
		JOIN permissions p ON p.id = rp.permission_id
		WHERE rp.role_id = $1
	`, roleID)
	if err != nil {
		return nil, fmt.Errorf("rbac: query role permissions: %w", err)
	}
	defer rows.Close()

	out := make(map[string]bool)
	for rows.Next() {
		var resource, action string
		if err := rows.Scan(&resource, &action); err != nil {
			return nil, fmt.Errorf("rbac: scan permission: %w", err)
		}
		out[resource+":"+action] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rbac: iterate permissions: %w", err)
	}
	return out, nil
}

// getOrLoadPerms 缓存优先；未命中则查 DB 后回填缓存。
func (s *rbacService) getOrLoadPerms(ctx context.Context, roleID int64) (map[string]bool, error) {
	if cached := s.loadPermsFromCache(roleID); cached != nil {
		return cached, nil
	}
	perms, err := s.loadPermsFromDB(ctx, roleID)
	if err != nil {
		return nil, err
	}
	s.storePermsToCache(roleID, perms)
	return perms, nil
}

// ============================================================
// HasPermission
// ============================================================

// HasPermission 判断 roleID 对 perm 是否有权。
//
// 匹配规则（按优先级，命中即返回 true）：
//  1. perms 含通配 "*:*" → true（超管）
//  2. perms 含 perm 字面量 → true
//  3. perm = "<resource>:<action>"，perms 含 "*:<action>" 或 "<resource>:*" → true
//
// 设计取舍：
//   - 不在 perm 上做更复杂解析（如允许 "project:*"）：v1 业务足够用上述三层；
//     若 future 需要按层级匹配，再扩展
//   - userID 当前未参与决策，但保留参数：将来如果引入"个人级 ACL 覆盖"
//     不会再 break interface
func (s *rbacService) HasPermission(ctx context.Context, userID, roleID int64, perm string) (bool, error) {
	if perm == "" {
		return false, errors.New("rbac: empty perm code")
	}
	perms, err := s.getOrLoadPerms(ctx, roleID)
	if err != nil {
		return false, err
	}
	// 1. 通配
	if perms["*:*"] {
		return true, nil
	}
	// 2. 完全匹配
	if perms[perm] {
		return true, nil
	}
	// 3. 半通配（resource 或 action 单边为 *）
	resource, action := splitPerm(perm)
	if resource != "" && action != "" {
		if perms["*:"+action] || perms[resource+":*"] {
			return true, nil
		}
	}
	return false, nil
}

// splitPerm 把 "<resource>:<action>" 拆为 (resource, action)；非法格式返回 ("", "")。
func splitPerm(perm string) (string, string) {
	for i := 0; i < len(perm); i++ {
		if perm[i] == ':' {
			return perm[:i], perm[i+1:]
		}
	}
	return "", ""
}

// ============================================================
// CanTriggerEvent
// ============================================================

// CanTriggerEvent 判断当前 session 在 projectID 上能否触发 eventCode。
//
// 校验链（按顺序，任一失败即 false）：
//  1. HasPermission(role, "event:"+eventCode)：role 必须有该事件权限
//  2. roleID == 1 (admin) 直接放行；否则查 project_members 验证 userID 是项目成员
//
// 注：spec §6 中"前置状态/持球者/允许角色"的细化校验放在 Phase 5 ProjectService.TriggerEvent
// 内的状态机引擎做；这里只管"角色是否有 event 权限 + 是否项目成员"两个粗粒度门。
func (s *rbacService) CanTriggerEvent(ctx context.Context, userID, roleID, projectID int64, eventCode string) (bool, error) {
	if eventCode == "" {
		return false, errors.New("rbac: empty event code")
	}
	// 第 1 层：role 是否拥有该 event 权限
	hasEventPerm, err := s.HasPermission(ctx, userID, roleID, "event:"+eventCode)
	if err != nil {
		return false, err
	}
	if !hasEventPerm {
		return false, nil
	}
	// 第 2 层：admin 直接放行
	if roleID == 1 {
		return true, nil
	}
	// 非 admin：必须是项目成员
	var exists bool
	err = s.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM project_members
			WHERE project_id = $1 AND user_id = $2
		)
	`, projectID, userID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("rbac: check project_members: %w", err)
	}
	return exists, nil
}

// ============================================================
// VisibilityFilter
// ============================================================

// VisibilityFilter 返回行级可见性 SQL 片段。
//
// v2 起：Postgres RLS + project_members 已承担所有行可见性判定，应用层不再拼 WHERE，
// 因此本方法恒返回 "TRUE"（占位让 SQL 编译器优化掉）+ 空参数。
// 保留方法签名是为了兼容 handler 已写的"附加 WHERE"模式，避免删除引发大面积重构。
func (s *rbacService) VisibilityFilter(_ context.Context, _, _ int64, _ string) (string, []any, error) {
	// RLS 已经把行级过滤做了，应用层不能再拼 WHERE 子句（重复过滤毫无意义且增加注入面）
	return "TRUE", nil, nil
}

// ============================================================
// ListPermissions / ListRoles
// ============================================================

// ListPermissions 列出全部 permission 行。
//
// 用途：管理 UI 给超管编辑角色权限时展示候选；普通用户也可读（GET /api/permissions 无 admin 限制）。
func (s *rbacService) ListPermissions(ctx context.Context) ([]Permission, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, resource, action, scope
		FROM permissions
		ORDER BY id
	`)
	if err != nil {
		return nil, fmt.Errorf("rbac: list permissions: %w", err)
	}
	defer rows.Close()

	var out []Permission
	for rows.Next() {
		var p Permission
		if err := rows.Scan(&p.ID, &p.Resource, &p.Action, &p.Scope); err != nil {
			return nil, fmt.Errorf("rbac: scan permission: %w", err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rbac: iterate permissions: %w", err)
	}
	return out, nil
}

// ListRoles 列出全部角色（系统角色 + 自定义角色）。
func (s *rbacService) ListRoles(ctx context.Context) ([]Role, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, description, is_system, created_at
		FROM roles
		ORDER BY id
	`)
	if err != nil {
		return nil, fmt.Errorf("rbac: list roles: %w", err)
	}
	defer rows.Close()

	var out []Role
	for rows.Next() {
		var (
			r       Role
			descRaw *string
		)
		if err := rows.Scan(&r.ID, &r.Name, &descRaw, &r.IsSystem, &r.CreatedAt); err != nil {
			return nil, fmt.Errorf("rbac: scan role: %w", err)
		}
		r.Description = descRaw
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rbac: iterate roles: %w", err)
	}
	return out, nil
}

// ============================================================
// LoadUserPermissions
// ============================================================

// LoadUserPermissions 加载 roleID 绑定的全部权限码（key），值恒为 true。
//
// 与 HasPermission 共享缓存：调用方拿到的 map 是缓存的引用，调用方不可写入。
// 业务用法：
//   - /api/auth/me 响应里附带 permissions 数组：keys(map)
//   - 后台 audit：列出某用户实际有哪些权限
func (s *rbacService) LoadUserPermissions(ctx context.Context, roleID int64) (map[string]bool, error) {
	perms, err := s.getOrLoadPerms(ctx, roleID)
	if err != nil {
		return nil, err
	}
	// 返回拷贝，防止 caller 改 map 污染缓存
	out := make(map[string]bool, len(perms))
	for k, v := range perms {
		out[k] = v
	}
	return out, nil
}

