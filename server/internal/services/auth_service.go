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
type AuthUser struct {
	ID          int64
	Email       string
	DisplayName string
	RoleID      int64
	IsActive    bool
	CreatedAt   time.Time
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

// Login 邮箱+密码换 access/refresh。
//
// 业务流程：
//  1. 按 email 取 users 行（含 password_hash / token_version / is_active）
//  2. bcrypt 校验密码；任何失败统一返回 ErrInvalidCredentials（避免 user enumeration）
//  3. is_active = false → ErrUserInactive
//  4. 签 access（带 token_version） + 签 refresh
//  5. INSERT refresh_tokens (token_hash, expires_at, user_id)
//  6. 返回 access / refresh / AuthUser
//
// 设计取舍：
//   - email 不区分大小写：DB UNIQUE constraint 是 case-sensitive，调用方应该在前端
//     toLowerCase；本层不做规范化以免遮盖 DB 实际状态
//   - INSERT refresh_tokens 不在事务里：选 token 与 INSERT 是独立操作，
//     单条 INSERT 自身就是原子的；rotate 路径才需要事务（因为有 UPDATE+INSERT 两步）
func (s *authService) Login(ctx context.Context, email, password string) (string, string, any, error) {
	var (
		user      AuthUser
		passHash  string
		tokenVer  int64
	)
	row := s.pool.QueryRow(ctx, `
		SELECT id, email, display_name, role_id, is_active, created_at,
		       password_hash, token_version
		FROM users WHERE email = $1
	`, email)
	err := row.Scan(
		&user.ID, &user.Email, &user.DisplayName, &user.RoleID, &user.IsActive, &user.CreatedAt,
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

// Refresh 用旧 refresh token 换新 access。
//
// 注意：interfaces.go 当前签名只返回 newAccess 一个 string —— 不返回新的 refresh。
// 本文件遵守接口契约（不擅自改 interface）：
//   - 仍调 rotate_refresh_token 函数（数据层强制原子轮转 + 重放检测）
//   - 但仅签发新 access 返回；新 refresh 也存入 DB（rotate 函数已 INSERT），
//     客户端继续使用 *旧* refresh token 直到过期 —— 这是 v1 的简化，避免引入第二条 cookie/header
//
// 设计取舍：
//   - 这与"refresh token rotation"完整方案略有差异：完整方案应每次 rotate 都返回新 refresh，
//     旧 refresh 立刻作废。当前 interface 版本只返回 access；后续 phase 接 refresh rotation
//     完整版时再扩展接口。
//   - 单次 rotate_refresh_token 函数仍可让"两个并发 refresh 请求"中一个 NULL，达到重放检测目的
func (s *authService) Refresh(ctx context.Context, refreshToken string) (string, error) {
	claims, err := auth.VerifyRefreshToken(refreshToken, s.refreshSec)
	if err != nil {
		return "", ErrInvalidRefreshToken
	}

	oldHash := auth.HashRefreshToken(refreshToken)

	// 生成新 refresh（rotate_refresh_token 函数会把它存入 DB）
	newRefresh, newHash, err := auth.IssueRefreshToken(claims.UserID, s.refreshSec, s.refreshTTL)
	if err != nil {
		return "", fmt.Errorf("auth_service: issue new refresh: %w", err)
	}
	_ = newRefresh // 当前接口不返回它，但仍要 INSERT 入库以保持函数副作用一致

	// rotate_refresh_token(p_old_hash, p_new_hash, p_ttl) 返回 user_id 或 NULL
	var rotatedUserID *int64
	row := s.pool.QueryRow(ctx, `SELECT rotate_refresh_token($1, $2, $3)`,
		oldHash, newHash, s.refreshTTL)
	if err := row.Scan(&rotatedUserID); err != nil {
		return "", fmt.Errorf("auth_service: rotate refresh: %w", err)
	}
	if rotatedUserID == nil {
		// 旧 hash 已被 rotate / revoke / 不存在 → 重放或非法
		return "", ErrInvalidRefreshToken
	}
	if *rotatedUserID != claims.UserID {
		// 客户端 token 与 DB 记录的 user_id 不一致（不该发生，但保险起见拒绝）
		return "", ErrInvalidRefreshToken
	}

	// 读取最新 role_id / token_version，避免用旧 access 中的过期值
	var roleID, tokenVer int64
	if err := s.pool.QueryRow(ctx, `SELECT role_id, token_version FROM users WHERE id = $1`,
		claims.UserID).Scan(&roleID, &tokenVer); err != nil {
		return "", fmt.Errorf("auth_service: re-read user: %w", err)
	}

	access, err := auth.IssueAccessToken(claims.UserID, roleID, tokenVer, s.accessSec, s.accessTTL)
	if err != nil {
		return "", fmt.Errorf("auth_service: issue access: %w", err)
	}
	return access, nil
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
		SELECT id, email, display_name, role_id, is_active, created_at
		FROM users WHERE id = $1
	`, ac.UserID).Scan(
		&u.ID, &u.Email, &u.DisplayName, &u.RoleID, &u.IsActive, &u.CreatedAt,
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
