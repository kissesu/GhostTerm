/*
@file auth_service.go
@description AuthService 的具体实现：
             - Login：bcrypt 校验 + 签发 access + 签发 refresh + 持久化 refresh hash
             - Refresh：调 rotate_refresh_token SECURITY DEFINER 函数原子轮转
             - Logout：递增 users.token_version + 撤销当前用户全部 refresh_tokens
             - Me：读 users + roles，返回 oas.User
             - VerifyAccessToken：jwt 签名校验 + DB 比对 token_version（强制踢下线）
             - IssueWSTicket / VerifyWSTicket：consume_ws_ticket 函数一次性消费

             SessionContext 的具体类型在本文件定义为 AuthContext，业务代码只读不改字段。
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

// AuthContext 是中间件解析 access token 后注入到 request context 的会话信息。
//
// 业务背景：
// - 后续 RBAC / 业务 service 都从 context 拿这个结构判断身份
// - TokenVersion 不出现在这里 —— 一旦中间件校验通过，token 已与 DB 一致；
//   service 层不需要再次比对
type AuthContext struct {
	UserID int64
	RoleID int64
}

// AuthUser 是 Login / Me 返回给 handler 的用户视图（与 oas.User 字段对齐）。
// 用户明确指令覆盖 spec §4：账号字段使用 Username 而非 Email。
type AuthUser struct {
	ID          int64
	Username    string
	DisplayName string
	RoleID      int64
	IsActive    bool
	CreatedAt   time.Time
}

// UpdateMeInput 当前登录用户自助修改基础信息的入参（个人中心）。
//
// 业务背景：
//   - 仅暴露 username / displayName 两个字段；权限敏感字段 roleId / isActive
//     由超管走 UserService.Update —— 防止用户给自己提权
//   - 字段为 nil 表示不修改；空字符串走 service 层的 trim 校验拒绝
type UpdateMeInput struct {
	Username    *string
	DisplayName *string
}

// authService 是 AuthService 的具体实现。
//
// 字段：
//   - pool：业务连接池（NOBYPASSRLS）；refresh_tokens / ws_tickets 的"敏感写"由
//     SECURITY DEFINER 函数承担，普通 query 仍走此池
//   - cfg：JWT secret / TTL / bcrypt cost 等运行时配置；不直接用 *config.Config
//     避免 services 包反向依赖 config
type authService struct {
	pool        *pgxpool.Pool
	accessSec   []byte
	refreshSec  []byte
	accessTTL   time.Duration
	refreshTTL  time.Duration
	wsTicketTTL time.Duration
	bcryptCost  int
}

// AuthServiceDeps 装配 authService 所需的全部依赖。
//
// 业务背景：拒绝在构造器里硬塞 *config.Config，因为 services 包语义上只关心
// "我需要哪些配置"，不关心 config 怎么读取的；这样后续替换 config 源（vault / consul）零侵入。
type AuthServiceDeps struct {
	Pool             *pgxpool.Pool
	AccessSecret     []byte
	RefreshSecret    []byte
	AccessTTL        time.Duration
	RefreshTTL       time.Duration
	BcryptCost       int
	WSTicketTTL      time.Duration // 默认 30s（spec §3.5），调用方不传时本文件兜底
}

// 编译时校验：authService 必须满足 AuthService interface
var _ AuthService = (*authService)(nil)

// NewAuthService 创建 AuthService 实现。
//
// 设计：
//   - 必填字段缺失 → 返回 error，不静默回 default（避免生产用错密钥）
//   - WSTicketTTL 是 spec 内固定常量（30s），允许调用方覆盖（测试场景需要长 TTL 调试）
func NewAuthService(deps AuthServiceDeps) (AuthService, error) {
	if deps.Pool == nil {
		return nil, errors.New("auth_service: pool is required")
	}
	if len(deps.AccessSecret) == 0 || len(deps.RefreshSecret) == 0 {
		return nil, errors.New("auth_service: access/refresh secret is required")
	}
	if deps.AccessTTL <= 0 || deps.RefreshTTL <= 0 {
		return nil, errors.New("auth_service: TTL must be positive")
	}
	if deps.BcryptCost < 4 {
		return nil, errors.New("auth_service: bcrypt cost too low (min 4)")
	}
	wsTTL := deps.WSTicketTTL
	if wsTTL <= 0 {
		wsTTL = 30 * time.Second
	}
	return &authService{
		pool:        deps.Pool,
		accessSec:   deps.AccessSecret,
		refreshSec:  deps.RefreshSecret,
		accessTTL:   deps.AccessTTL,
		refreshTTL:  deps.RefreshTTL,
		wsTicketTTL: wsTTL,
		bcryptCost:  deps.BcryptCost,
	}, nil
}

// ============================================================
// Sentinel errors —— handler 层据此映射到 ErrorEnvelope.code
// ============================================================

// ErrInvalidCredentials 用户名或密码错误（合并返回，避免暴露 user 是否存在）。
var ErrInvalidCredentials = errors.New("invalid_credentials")

// ErrUserInactive 用户被禁用，不允许登录。
var ErrUserInactive = errors.New("user_inactive")

// ErrInvalidRefreshToken refresh token 签名错 / 已过期 / 已被 rotate / 已被撤销。
var ErrInvalidRefreshToken = errors.New("invalid_refresh_token")

// ErrInvalidAccessToken access token 签名错 / 过期 / token_version 不匹配。
var ErrInvalidAccessToken = errors.New("invalid_access_token")

// ErrInvalidWSTicket ticket 不存在 / 已过期 / 已被使用。
var ErrInvalidWSTicket = errors.New("invalid_ws_ticket")

// ============================================================
// Login
// ============================================================

// Login username+密码换 access/refresh。
//
// 业务流程：
//  1. 按 username 取 users 行（含 password_hash / token_version / is_active）
//  2. bcrypt 校验密码；任何失败统一返回 ErrInvalidCredentials（避免 user enumeration）
//  3. is_active = false → ErrUserInactive
//  4. 签 access（带 token_version） + 签 refresh
//  5. INSERT refresh_tokens (token_hash, expires_at, user_id)
//  6. 返回 access / refresh / AuthUser
//
// 设计取舍：
//   - username 大小写敏感：DB UNIQUE constraint 是 case-sensitive；本层不做规范化
//   - INSERT refresh_tokens 不在事务里：选 token 与 INSERT 是独立操作，
//     单条 INSERT 自身就是原子的；rotate 路径才需要事务（因为有 UPDATE+INSERT 两步）
func (s *authService) Login(ctx context.Context, username, password string) (string, string, any, error) {
	var (
		user      AuthUser
		passHash  string
		tokenVer  int64
	)
	row := s.pool.QueryRow(ctx, `
		SELECT id, username, display_name, role_id, is_active, created_at,
		       password_hash, token_version
		FROM users WHERE username = $1
	`, username)
	err := row.Scan(
		&user.ID, &user.Username, &user.DisplayName, &user.RoleID, &user.IsActive, &user.CreatedAt,
		&passHash, &tokenVer,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", "", nil, ErrInvalidCredentials
		}
		return "", "", nil, fmt.Errorf("auth_service: query user: %w", err)
	}
	if !auth.VerifyPassword(password, passHash) {
		return "", "", nil, ErrInvalidCredentials
	}
	if !user.IsActive {
		return "", "", nil, ErrUserInactive
	}

	access, err := auth.IssueAccessToken(user.ID, user.RoleID, tokenVer, s.accessSec, s.accessTTL)
	if err != nil {
		return "", "", nil, fmt.Errorf("auth_service: issue access: %w", err)
	}
	refresh, refreshHash, err := auth.IssueRefreshToken(user.ID, s.refreshSec, s.refreshTTL)
	if err != nil {
		return "", "", nil, fmt.Errorf("auth_service: issue refresh: %w", err)
	}

	expiresAt := time.Now().Add(s.refreshTTL)
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`, user.ID, refreshHash, expiresAt); err != nil {
		return "", "", nil, fmt.Errorf("auth_service: persist refresh: %w", err)
	}

	return access, refresh, user, nil
}

// ============================================================
// Refresh
// ============================================================

// Refresh 用旧 refresh token 换新 access + 新 refresh。
//
// 完整 refresh token rotation 语义：
//   - 调 rotate_refresh_token 函数（数据层原子轮转 + 重放检测）
//   - 旧 refresh 立刻 revoked；签发新 refresh 入库
//   - **返回新 refresh 给 client**，client 必须写回 localStorage 替换旧值
//   - 同 token 第二次 refresh → DB rotate 返 NULL → 401（重放检测）
//
// 此前 v1 版本只返 access 不返 refresh，导致 client 二次 refresh 必失败
// （root cause: 浏览器刷新 + StrictMode 双 mount 让 verify() 并发调 refresh 二次，
//  第二次用已 revoked 的旧 token → 401 → 用户被误展 NoPermissionFallback）
func (s *authService) Refresh(ctx context.Context, refreshToken string) (string, string, error) {
	claims, err := auth.VerifyRefreshToken(refreshToken, s.refreshSec)
	if err != nil {
		return "", "", ErrInvalidRefreshToken
	}

	oldHash := auth.HashRefreshToken(refreshToken)

	// 生成新 refresh（rotate_refresh_token 函数会把它存入 DB）
	newRefresh, newHash, err := auth.IssueRefreshToken(claims.UserID, s.refreshSec, s.refreshTTL)
	if err != nil {
		return "", "", fmt.Errorf("auth_service: issue new refresh: %w", err)
	}

	// rotate_refresh_token(p_old_hash, p_new_hash, p_ttl) 返回 user_id 或 NULL
	var rotatedUserID *int64
	row := s.pool.QueryRow(ctx, `SELECT rotate_refresh_token($1, $2, $3)`,
		oldHash, newHash, s.refreshTTL)
	if err := row.Scan(&rotatedUserID); err != nil {
		return "", "", fmt.Errorf("auth_service: rotate refresh: %w", err)
	}
	if rotatedUserID == nil {
		// 旧 hash 已被 rotate / revoke / 不存在 → 重放或非法
		return "", "", ErrInvalidRefreshToken
	}
	if *rotatedUserID != claims.UserID {
		// 客户端 token 与 DB 记录的 user_id 不一致（不该发生，但保险起见拒绝）
		return "", "", ErrInvalidRefreshToken
	}

	// 读取最新 role_id / token_version，避免用旧 access 中的过期值
	var roleID, tokenVer int64
	if err := s.pool.QueryRow(ctx, `SELECT role_id, token_version FROM users WHERE id = $1`,
		claims.UserID).Scan(&roleID, &tokenVer); err != nil {
		return "", "", fmt.Errorf("auth_service: re-read user: %w", err)
	}

	access, err := auth.IssueAccessToken(claims.UserID, roleID, tokenVer, s.accessSec, s.accessTTL)
	if err != nil {
		return "", "", fmt.Errorf("auth_service: issue access: %w", err)
	}
	return access, newRefresh, nil
}

// ============================================================
// Logout
// ============================================================

// Logout 把 sc 携带用户的 token_version+1，并撤销其全部未撤销 refresh_tokens。
//
// 业务流程：
//  1. 把 sc 转成 AuthContext（接口签名是 SessionContext = any，本实现内强转）
//  2. 单事务内：
//     - UPDATE users SET token_version = token_version + 1
//     - UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL
//  3. 之后所有签出的旧 access token 在中间件比对 token_version 时都会失败
//
// 设计取舍：
//   - 用事务而不是两条独立 SQL：避免"version 涨了但 refresh 没 revoke"的部分失败
//   - 不删 refresh_tokens 行：保留审计 trail；revoked_at 时间戳即代表失效
func (s *authService) Logout(ctx context.Context, sc SessionContext) error {
	ac, ok := sc.(AuthContext)
	if !ok {
		return errors.New("auth_service: invalid session context type")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("auth_service: begin logout tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }() // commit 成功后 rollback 无副作用

	if _, err := tx.Exec(ctx, `
		UPDATE users SET token_version = token_version + 1, updated_at = NOW()
		WHERE id = $1
	`, ac.UserID); err != nil {
		return fmt.Errorf("auth_service: bump token_version: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE refresh_tokens SET revoked_at = NOW()
		WHERE user_id = $1 AND revoked_at IS NULL
	`, ac.UserID); err != nil {
		return fmt.Errorf("auth_service: revoke refresh tokens: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("auth_service: commit logout: %w", err)
	}
	return nil
}

// ============================================================
// VerifyAccessToken（中间件入口）
// ============================================================

// VerifyAccessToken 由中间件调用，做两层校验：
//  1. JWT 签名 / 算法 / 过期 / iss 匹配（auth.VerifyAccessToken）
//  2. token_version 与 DB users.token_version 一致（防止 logout-all 后旧 token 仍被接受）
//
// 返回值 SessionContext = AuthContext 类型，handler 层 type assert 后使用。
func (s *authService) VerifyAccessToken(ctx context.Context, accessToken string) (SessionContext, error) {
	claims, err := auth.VerifyAccessToken(accessToken, s.accessSec)
	if err != nil {
		return nil, ErrInvalidAccessToken
	}

	var dbVersion int64
	var isActive bool
	if err := s.pool.QueryRow(ctx, `
		SELECT token_version, is_active FROM users WHERE id = $1
	`, claims.UserID).Scan(&dbVersion, &isActive); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInvalidAccessToken
		}
		return nil, fmt.Errorf("auth_service: re-read user: %w", err)
	}
	if !isActive {
		return nil, ErrUserInactive
	}
	if dbVersion != claims.TokenVersion {
		return nil, ErrInvalidAccessToken
	}
	return AuthContext{UserID: claims.UserID, RoleID: claims.RoleID}, nil
}

// ============================================================
// Me
// ============================================================

// Me 读取当前用户基础信息（不返回 password_hash / token_version）。
//
// 按 interfaces.go 的 SessionContext = any 契约：调用方传入的 sc 必须是 AuthContext。
func (s *authService) Me(ctx context.Context, sc SessionContext) (any, error) {
	ac, ok := sc.(AuthContext)
	if !ok {
		return nil, errors.New("auth_service: invalid session context type")
	}
	var u AuthUser
	if err := s.pool.QueryRow(ctx, `
		SELECT id, username, display_name, role_id, is_active, created_at
		FROM users WHERE id = $1
	`, ac.UserID).Scan(
		&u.ID, &u.Username, &u.DisplayName, &u.RoleID, &u.IsActive, &u.CreatedAt,
	); err != nil {
		return nil, fmt.Errorf("auth_service: read me: %w", err)
	}
	return u, nil
}

// ============================================================
// IssueWSTicket / VerifyWSTicket
// ============================================================

// IssueWSTicket 签发短期 WS ticket（默认 30s）。
//
// 业务流程：
//  1. 生成 raw + sha256 hash
//  2. INSERT ws_tickets (ticket_hash, user_id, role_id, expires_at)
//  3. 返回 raw（仅一次性，客户端立刻拿去发起 WS upgrade）
func (s *authService) IssueWSTicket(ctx context.Context, sc SessionContext) (string, time.Time, error) {
	ac, ok := sc.(AuthContext)
	if !ok {
		return "", time.Time{}, errors.New("auth_service: invalid session context type")
	}
	raw, hash, err := auth.IssueWSTicketRaw()
	if err != nil {
		return "", time.Time{}, err
	}
	expiresAt := time.Now().Add(s.wsTicketTTL)
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO ws_tickets (ticket_hash, user_id, role_id, expires_at)
		VALUES ($1, $2, $3, $4)
	`, hash, ac.UserID, ac.RoleID, expiresAt); err != nil {
		return "", time.Time{}, fmt.Errorf("auth_service: persist ws ticket: %w", err)
	}
	return raw, expiresAt, nil
}

// ============================================================
// ChangePassword（个人中心：自助修改密码）
// ============================================================

// ChangePassword 当前登录用户自助修改密码。
//
// 业务流程：
//  1. 从 sc 取 AuthContext.UserID（中间件已注入；handler 不需要再传）
//  2. SELECT password_hash FOR UPDATE 锁行，避免并发改密丢失
//  3. bcrypt.VerifyPassword 比对 oldPassword；失败 → ErrInvalidCredentials
//  4. 校验 newPassword 强度（≥8 位，与超管创建用户对齐）；失败 → ErrInvalidUserInput
//  5. bcrypt rehash newPassword + UPDATE password_hash + token_version+1 + updated_at
//  6. UPDATE refresh_tokens SET revoked_at = NOW()，让其它会话立即失效
//
// 设计取舍：
//   - 不让当前 access token 立即失效：access token 仍在 TTL（默认 15min）内可用，
//     避免修改密码后用户立刻被踢登录页；前端会引导用户主动重新登录
//   - 用事务而非两条独立 SQL：避免"密码改了但 refresh 没 revoke"的部分失败
func (s *authService) ChangePassword(ctx context.Context, sc SessionContext, oldPassword, newPassword string) error {
	ac, ok := sc.(AuthContext)
	if !ok {
		return errors.New("auth_service: invalid session context type")
	}
	if len(newPassword) < 8 {
		// 与超管创建用户的 minLength: 8 对齐；防止前端校验被绕过后 bcrypt 形同虚设
		return fmt.Errorf("%w: 新密码至少 8 位", ErrInvalidUserInput)
	}
	if oldPassword == newPassword {
		// 业务约束：防止用户"修改"成相同密码（误操作或误以为已改）
		return fmt.Errorf("%w: 新密码不能与旧密码相同", ErrInvalidUserInput)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("auth_service: begin change-password tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var passHash string
	row := tx.QueryRow(ctx, `
		SELECT password_hash FROM users WHERE id = $1 FOR UPDATE
	`, ac.UserID)
	if err := row.Scan(&passHash); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// 中间件已通过 token_version 校验保证用户存在；走到这里 = 数据被并发删
			return ErrInvalidCredentials
		}
		return fmt.Errorf("auth_service: lock user for change-password: %w", err)
	}
	if !auth.VerifyPassword(oldPassword, passHash) {
		// 与登录路径同样合并提示，避免 timing 暴露用户存在性
		return ErrInvalidCredentials
	}

	newHash, err := auth.HashPassword(newPassword, s.bcryptCost)
	if err != nil {
		return fmt.Errorf("auth_service: hash new password: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE users
		SET password_hash = $1,
		    token_version = token_version + 1,
		    updated_at = NOW()
		WHERE id = $2
	`, newHash, ac.UserID); err != nil {
		return fmt.Errorf("auth_service: update password: %w", err)
	}
	// 撤销其它会话的 refresh：当前会话的 access token 仍在内存有效；用户主动重登才彻底失效
	if _, err := tx.Exec(ctx, `
		UPDATE refresh_tokens SET revoked_at = NOW()
		WHERE user_id = $1 AND revoked_at IS NULL
	`, ac.UserID); err != nil {
		return fmt.Errorf("auth_service: revoke refresh tokens: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("auth_service: commit change-password: %w", err)
	}
	return nil
}

// ============================================================
// UpdateMe（个人中心：自助修改 username / displayName）
// ============================================================

// UpdateMe 当前登录用户自助修改基础信息（仅 username / displayName）。
//
// 业务流程：
//  1. 从 sc 取 AuthContext.UserID
//  2. SELECT 当前快照 + FOR UPDATE 锁行
//  3. 按非 nil 字段动态构造 UPDATE；空白 username 拒绝；不变化字段不写
//  4. UNIQUE 冲突 → ErrUsernameTaken
//  5. RETURNING 回 AuthUser 给 handler 包成 oas.User 返前端
//
// 设计取舍：
//   - 复用 UserService.Update 的列锁 + 动态 SQL 模式（同语义）；
//     不直接调 UserService.Update 是因为后者要求超管校验，此处属于"自助"路径
//   - 修改 username / displayName 不递增 token_version（不是安全敏感字段）
func (s *authService) UpdateMe(ctx context.Context, sc SessionContext, in UpdateMeInput) (any, error) {
	ac, ok := sc.(AuthContext)
	if !ok {
		return nil, errors.New("auth_service: invalid session context type")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("auth_service: begin update-me tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var existing AuthUser
	if err := tx.QueryRow(ctx, `
		SELECT id, username, display_name, role_id, is_active, created_at
		FROM users WHERE id = $1 FOR UPDATE
	`, ac.UserID).Scan(
		&existing.ID, &existing.Username, &existing.DisplayName, &existing.RoleID, &existing.IsActive, &existing.CreatedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("auth_service: lock user for update-me: %w", err)
	}

	// 动态字段（白名单 SQL 列名，禁止拼用户输入）
	sets := []string{}
	args := []any{}
	idx := 1
	if in.Username != nil {
		un := strings.TrimSpace(*in.Username)
		if un == "" {
			return nil, fmt.Errorf("%w: username 不能为空", ErrInvalidUserInput)
		}
		if un != existing.Username {
			sets = append(sets, fmt.Sprintf("username = $%d", idx))
			args = append(args, un)
			idx++
		}
	}
	if in.DisplayName != nil {
		dn := strings.TrimSpace(*in.DisplayName)
		if dn == "" {
			return nil, fmt.Errorf("%w: displayName 不能为空", ErrInvalidUserInput)
		}
		if dn != existing.DisplayName {
			sets = append(sets, fmt.Sprintf("display_name = $%d", idx))
			args = append(args, dn)
			idx++
		}
	}

	if len(sets) == 0 {
		// 无字段变化：不写库直接返回当前快照
		if err := tx.Commit(ctx); err != nil {
			return nil, fmt.Errorf("auth_service: commit update-me no-op: %w", err)
		}
		return existing, nil
	}
	sets = append(sets, "updated_at = NOW()")
	args = append(args, ac.UserID)

	q := fmt.Sprintf(`
		UPDATE users SET %s
		WHERE id = $%d
		RETURNING id, username, display_name, role_id, is_active, created_at
	`, strings.Join(sets, ", "), idx)

	var updated AuthUser
	if err := tx.QueryRow(ctx, q, args...).Scan(
		&updated.ID, &updated.Username, &updated.DisplayName, &updated.RoleID, &updated.IsActive, &updated.CreatedAt,
	); err != nil {
		if isUniqueViolation(err) {
			return nil, ErrUsernameTaken
		}
		return nil, fmt.Errorf("auth_service: update me: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("auth_service: commit update-me: %w", err)
	}
	return updated, nil
}

// VerifyWSTicket 调 consume_ws_ticket(hash) SECURITY DEFINER 函数一次性消费。
//
// 函数返回 (user_id, role_id) 或 0 行；任何失败映射为 ErrInvalidWSTicket。
func (s *authService) VerifyWSTicket(ctx context.Context, ticket string) (SessionContext, error) {
	if strings.TrimSpace(ticket) == "" {
		return nil, ErrInvalidWSTicket
	}
	hash := auth.HashWSTicket(ticket)

	var userID, roleID int64
	row := s.pool.QueryRow(ctx, `SELECT user_id, role_id FROM consume_ws_ticket($1)`, hash)
	if err := row.Scan(&userID, &roleID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInvalidWSTicket
		}
		return nil, fmt.Errorf("auth_service: consume ws ticket: %w", err)
	}
	return AuthContext{UserID: userID, RoleID: roleID}, nil
}
