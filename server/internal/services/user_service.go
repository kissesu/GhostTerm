/*
@file user_service.go
@description UserService 实现：超管使用的用户 CRUD 服务（仅 admin 调用，handler 入口做 RBAC 校验）。
             - List：返回所有用户视图（按 id 升序）；不返回 password_hash / token_version
             - Create：bcrypt 密码 hash + INSERT；username 重复返回 ErrUsernameTaken
             - Update：可改 username/displayName/roleId/isActive，密码可选；
                       禁用账号或修改 roleId 时递增 token_version 强制踢下线
             - Delete：软删除 = is_active=false + token_version+1；保留审计 trail，
                       不真正 DELETE 行（外键 + 审计需求）
             业务上仅由 Atlas 模块的 UsersHandler 调用，跨模块不直接暴露。
@author Atlas.oi
@date 2026-04-29
*/

package services

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ghostterm/progress-server/internal/auth"
)

// ErrUsernameTaken username 已存在（INSERT 时 UNIQUE 冲突映射）。
var ErrUsernameTaken = errors.New("username_taken")

// ErrUserNotFound 用户 id 不存在。
var ErrUserNotFound = errors.New("user_not_found")

// ErrInvalidUserInput 创建/更新时的字段校验失败（弱密码 / 空 username 等）。
var ErrInvalidUserInput = errors.New("invalid_user_input")

// ============================================================
// UserService 接口（用户管理后台专用）
// ============================================================

// UserView 是 UserService 列表/读取返回的视图模型，与 oas.User 字段对齐
// （但不含 permissions —— Atlas 后台无需展示当前请求用户权限码）。
type UserView struct {
	ID          int64
	Username    string
	DisplayName string
	RoleID      int64
	IsActive    bool
	CreatedAt   time.Time
}

// UserCreateInput 创建用户的入参。
//
// 业务背景：
//   - Password 是明文，service 层做 bcrypt hash 后入库
//   - DisplayName 缺省时使用 Username 兜底（与 0001 migration 行为一致）
type UserCreateInput struct {
	Username    string
	Password    string
	DisplayName *string // nil → fallback 到 Username
	RoleID      int64
}

// UserUpdateInput PATCH 入参，所有字段都是可选；nil 表示不修改。
//
// 业务背景：
//   - Password 改为 nil 表示保留原密码；非 nil 时做 bcrypt rehash
//   - RoleID / IsActive 变更会递增 token_version，强制旧 token 失效
type UserUpdateInput struct {
	Username    *string
	Password    *string
	DisplayName *string
	RoleID      *int64
	IsActive    *bool
}

// UserService 用户管理（仅超管使用）。
//
// 设计取舍：
//   - handler 层做 RBAC（roleID==1 或 user:create 权限）校验后调本 service；
//     service 不再次校验避免双层职责重复
//   - 不和 RBACService 合并：RBAC 关心 role/permission 结构；UserService 关心 user CRUD，
//     合到一起会让 RBAC service 职责膨胀
type UserService interface {
	List(ctx context.Context) ([]UserView, error)
	Create(ctx context.Context, in UserCreateInput) (UserView, error)
	Update(ctx context.Context, id int64, in UserUpdateInput) (UserView, error)
	Delete(ctx context.Context, id int64) error
}

// ============================================================
// 实现
// ============================================================

type userService struct {
	pool       *pgxpool.Pool
	bcryptCost int
}

// UserServiceDeps 依赖注入。
type UserServiceDeps struct {
	Pool       *pgxpool.Pool
	BcryptCost int
}

// 编译时校验
var _ UserService = (*userService)(nil)

// NewUserService 构造 UserService 实现，必填字段缺失时返回 error。
func NewUserService(deps UserServiceDeps) (UserService, error) {
	if deps.Pool == nil {
		return nil, errors.New("user_service: pool is required")
	}
	if deps.BcryptCost < 4 {
		return nil, errors.New("user_service: bcrypt cost too low (min 4)")
	}
	return &userService{pool: deps.Pool, bcryptCost: deps.BcryptCost}, nil
}

// ----------------------------------------------------------
// List
// ----------------------------------------------------------

// List 查询所有用户（按 id 升序）。
func (s *userService) List(ctx context.Context) ([]UserView, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, username, display_name, role_id, is_active, created_at
		FROM users
		ORDER BY id
	`)
	if err != nil {
		return nil, fmt.Errorf("user_service: query users: %w", err)
	}
	defer rows.Close()

	var out []UserView
	for rows.Next() {
		var u UserView
		if err := rows.Scan(&u.ID, &u.Username, &u.DisplayName, &u.RoleID, &u.IsActive, &u.CreatedAt); err != nil {
			return nil, fmt.Errorf("user_service: scan user: %w", err)
		}
		out = append(out, u)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("user_service: iterate users: %w", err)
	}
	return out, nil
}

// ----------------------------------------------------------
// Create
// ----------------------------------------------------------

// Create 创建用户：
//  1. 校验非空 username + 密码长度；非法 → ErrInvalidUserInput
//  2. bcrypt hash 密码
//  3. INSERT users (...) 并返回 created_at
//  4. UNIQUE constraint 冲突 → ErrUsernameTaken
func (s *userService) Create(ctx context.Context, in UserCreateInput) (UserView, error) {
	if strings.TrimSpace(in.Username) == "" {
		return UserView{}, fmt.Errorf("%w: username 不能为空", ErrInvalidUserInput)
	}
	if len(in.Password) < 6 {
		// 与前端校验对齐；放行短密码会让 bcrypt 形同虚设
		return UserView{}, fmt.Errorf("%w: 密码至少 6 位", ErrInvalidUserInput)
	}

	hash, err := auth.HashPassword(in.Password, s.bcryptCost)
	if err != nil {
		return UserView{}, fmt.Errorf("user_service: hash password: %w", err)
	}

	displayName := in.Username
	if in.DisplayName != nil && strings.TrimSpace(*in.DisplayName) != "" {
		displayName = *in.DisplayName
	}

	var u UserView
	row := s.pool.QueryRow(ctx, `
		INSERT INTO users (username, display_name, password_hash, role_id, is_active)
		VALUES ($1, $2, $3, $4, TRUE)
		RETURNING id, username, display_name, role_id, is_active, created_at
	`, in.Username, displayName, hash, in.RoleID)
	if err := row.Scan(&u.ID, &u.Username, &u.DisplayName, &u.RoleID, &u.IsActive, &u.CreatedAt); err != nil {
		// 唯一约束冲突 23505
		if isUniqueViolation(err) {
			return UserView{}, ErrUsernameTaken
		}
		return UserView{}, fmt.Errorf("user_service: insert user: %w", err)
	}
	return u, nil
}

// ----------------------------------------------------------
// Update
// ----------------------------------------------------------

// Update 修改用户。
//
// 业务流程：
//  1. 用 SELECT FOR UPDATE 锁行，避免并发改 token_version 丢失
//  2. 按 input 非 nil 字段构造动态 UPDATE
//  3. 修改 roleId / isActive=false / Password 任一 → token_version+1（踢下线旧 token）
func (s *userService) Update(ctx context.Context, id int64, in UserUpdateInput) (UserView, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return UserView{}, fmt.Errorf("user_service: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var existing UserView
	row := tx.QueryRow(ctx, `
		SELECT id, username, display_name, role_id, is_active, created_at
		FROM users WHERE id = $1 FOR UPDATE
	`, id)
	if err := row.Scan(&existing.ID, &existing.Username, &existing.DisplayName, &existing.RoleID, &existing.IsActive, &existing.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return UserView{}, ErrUserNotFound
		}
		return UserView{}, fmt.Errorf("user_service: lock user: %w", err)
	}

	// 计算需要 token_version+1 的条件（敏感字段变更才递增，避免每次 PATCH 都踢下线）
	bumpVersion := false

	// 动态字段（白名单 SQL 列名，禁止拼接用户输入）
	sets := []string{}
	args := []any{}
	idx := 1

	if in.Username != nil {
		un := strings.TrimSpace(*in.Username)
		if un == "" {
			return UserView{}, fmt.Errorf("%w: username 不能为空", ErrInvalidUserInput)
		}
		sets = append(sets, fmt.Sprintf("username = $%d", idx))
		args = append(args, un)
		idx++
	}
	if in.DisplayName != nil {
		sets = append(sets, fmt.Sprintf("display_name = $%d", idx))
		args = append(args, *in.DisplayName)
		idx++
	}
	if in.Password != nil {
		if len(*in.Password) < 6 {
			return UserView{}, fmt.Errorf("%w: 密码至少 6 位", ErrInvalidUserInput)
		}
		hash, err := auth.HashPassword(*in.Password, s.bcryptCost)
		if err != nil {
			return UserView{}, fmt.Errorf("user_service: hash password: %w", err)
		}
		sets = append(sets, fmt.Sprintf("password_hash = $%d", idx))
		args = append(args, hash)
		idx++
		bumpVersion = true
	}
	if in.RoleID != nil && *in.RoleID != existing.RoleID {
		sets = append(sets, fmt.Sprintf("role_id = $%d", idx))
		args = append(args, *in.RoleID)
		idx++
		bumpVersion = true
	}
	if in.IsActive != nil && *in.IsActive != existing.IsActive {
		sets = append(sets, fmt.Sprintf("is_active = $%d", idx))
		args = append(args, *in.IsActive)
		idx++
		// 仅在禁用时踢下线；启用账号无需踢
		if !*in.IsActive {
			bumpVersion = true
		}
	}

	if bumpVersion {
		sets = append(sets, "token_version = token_version + 1")
	}
	if len(sets) == 0 {
		// 无字段变化：直接返回当前快照（避免无意义 UPDATE）
		if err := tx.Commit(ctx); err != nil {
			return UserView{}, fmt.Errorf("user_service: commit: %w", err)
		}
		return existing, nil
	}
	sets = append(sets, "updated_at = NOW()")

	// WHERE id = $N
	args = append(args, id)
	q := fmt.Sprintf(`
		UPDATE users SET %s
		WHERE id = $%d
		RETURNING id, username, display_name, role_id, is_active, created_at
	`, strings.Join(sets, ", "), idx)

	var updated UserView
	if err := tx.QueryRow(ctx, q, args...).Scan(
		&updated.ID, &updated.Username, &updated.DisplayName, &updated.RoleID, &updated.IsActive, &updated.CreatedAt,
	); err != nil {
		if isUniqueViolation(err) {
			return UserView{}, ErrUsernameTaken
		}
		return UserView{}, fmt.Errorf("user_service: update user: %w", err)
	}

	// 敏感字段变更：撤销该用户全部 refresh_tokens
	if bumpVersion {
		if _, err := tx.Exec(ctx, `
			UPDATE refresh_tokens SET revoked_at = NOW()
			WHERE user_id = $1 AND revoked_at IS NULL
		`, id); err != nil {
			return UserView{}, fmt.Errorf("user_service: revoke refresh tokens: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return UserView{}, fmt.Errorf("user_service: commit: %w", err)
	}
	return updated, nil
}

// ----------------------------------------------------------
// Delete
// ----------------------------------------------------------

// Delete 软删除：is_active=false + token_version+1 + revoke refresh tokens。
//
// 业务背景：
//   - 物理 DELETE 会破坏 projects.assignee_id / status_change_logs.actor_id 等历史记录
//   - 软删除让审计 trail 完整保留；同时禁用 + 踢下线
func (s *userService) Delete(ctx context.Context, id int64) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("user_service: begin delete tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	tag, err := tx.Exec(ctx, `
		UPDATE users
		SET is_active = FALSE,
		    token_version = token_version + 1,
		    updated_at = NOW()
		WHERE id = $1
	`, id)
	if err != nil {
		return fmt.Errorf("user_service: soft delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrUserNotFound
	}
	if _, err := tx.Exec(ctx, `
		UPDATE refresh_tokens SET revoked_at = NOW()
		WHERE user_id = $1 AND revoked_at IS NULL
	`, id); err != nil {
		return fmt.Errorf("user_service: revoke refresh: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("user_service: commit delete: %w", err)
	}
	return nil
}

// ============================================================
// 辅助
// ============================================================

// isUniqueViolation 检查 pgx error 是否为 23505 unique_violation。
//
// 注：避免 import pgconn 包导致 import cycle 风险，用字符串模式匹配。
// pgx 错误的 Error() 中包含 SQLSTATE 23505 字样。
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "SQLSTATE 23505") || strings.Contains(err.Error(), "23505")
}
