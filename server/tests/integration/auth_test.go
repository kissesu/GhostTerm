/*
@file auth_test.go
@description AuthService + auth helpers 的端到端集成测试。
             覆盖：
               1. 用户 seed → bcrypt 校验 → Login 成功
               2. Refresh rotate（旧 token 不可重放）
               3. Logout → token_version 自增 + 旧 access 失效
               4. WS ticket 一次性消费 + 重放被拒
               5. 错密码 → ErrInvalidCredentials；无效 token → ErrInvalidAccessToken
@author Atlas.oi
@date 2026-04-29
*/

package integration

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"github.com/ghostterm/progress-server/internal/auth"
	"github.com/ghostterm/progress-server/internal/services"
	"github.com/ghostterm/progress-server/internal/testutil"
)

// authTestEnv 持有一次集成测试需要的全部资源（pool + service + 已 seed 用户）
type authTestEnv struct {
	pool     *pgxpool.Pool
	svc      services.AuthService
	cleanup  func()
	userID   int64
	roleID   int64
	password string
	username string
}

// setupAuthEnv 启 postgres 容器、构造 AuthService、seed 一个 active 用户。
//
// 测试侧 bcrypt cost 用 MinCost(=4) 让单个测试 < 1s；生产 cost 由 config 决定。
// 用 spec §3.4 的 manager(role_id=2) 角色 —— 0001 迁移已 INSERT 三个 role。
func setupAuthEnv(t *testing.T) *authTestEnv {
	t.Helper()
	pool, cleanup := testutil.StartPostgres(t)

	svc, err := services.NewAuthService(services.AuthServiceDeps{
		Pool:          pool,
		AccessSecret:  []byte("test-access-secret-32-bytes-min!!"),
		RefreshSecret: []byte("test-refresh-secret-32-bytes-min!"),
		AccessTTL:     5 * time.Minute,
		RefreshTTL:    24 * time.Hour,
		BcryptCost:    bcrypt.MinCost,
		WSTicketTTL:   30 * time.Second,
	})
	require.NoError(t, err)

	const password = "S3cret-pa55"
	hash, err := auth.HashPassword(password, bcrypt.MinCost)
	require.NoError(t, err)

	const username = "alice"
	const roleID = int64(2) // 开发，由 0001 migration 预置
	var userID int64
	err = pool.QueryRow(context.Background(), `
		INSERT INTO users (username, password_hash, display_name, role_id, is_active)
		VALUES ($1, $2, 'Alice', $3, TRUE)
		RETURNING id
	`, username, hash, roleID).Scan(&userID)
	require.NoError(t, err)

	return &authTestEnv{
		pool:     pool,
		svc:      svc,
		cleanup:  cleanup,
		userID:   userID,
		roleID:   roleID,
		password: password,
		username: username,
	}
}

// ------------------------------------------------------------
// Login
// ------------------------------------------------------------

func TestAuth_LoginSuccess(t *testing.T) {
	env := setupAuthEnv(t)
	defer env.cleanup()

	access, refresh, raw, err := env.svc.Login(context.Background(), env.username, env.password)
	require.NoError(t, err)
	assert.NotEmpty(t, access)
	assert.NotEmpty(t, refresh)

	user, ok := raw.(services.AuthUser)
	require.True(t, ok, "Login 返回的 user 必须是 services.AuthUser")
	assert.Equal(t, env.userID, user.ID)
	assert.Equal(t, env.username, user.Username)
	assert.Equal(t, env.roleID, user.RoleID)
	assert.True(t, user.IsActive)

	// access token 可被中间件路径校验
	sc, err := env.svc.VerifyAccessToken(context.Background(), access)
	require.NoError(t, err)
	ac, ok := sc.(services.AuthContext)
	require.True(t, ok)
	assert.Equal(t, env.userID, ac.UserID)
	assert.Equal(t, env.roleID, ac.RoleID)
}

func TestAuth_LoginWrongPassword(t *testing.T) {
	env := setupAuthEnv(t)
	defer env.cleanup()

	_, _, _, err := env.svc.Login(context.Background(), env.username, "wrong-password")
	assert.ErrorIs(t, err, services.ErrInvalidCredentials)
}

func TestAuth_LoginUnknownUsername(t *testing.T) {
	env := setupAuthEnv(t)
	defer env.cleanup()

	_, _, _, err := env.svc.Login(context.Background(), "ghost-user", "anything")
	// 未知 username 也返回 invalid_credentials（避免 user enumeration）
	assert.ErrorIs(t, err, services.ErrInvalidCredentials)
}

// ------------------------------------------------------------
// Refresh：旋转后旧 token 应被 rotate_refresh_token 函数标为 revoked，重放返回 NULL
// ------------------------------------------------------------

func TestAuth_RefreshRotation(t *testing.T) {
	env := setupAuthEnv(t)
	defer env.cleanup()

	_, refresh, _, err := env.svc.Login(context.Background(), env.username, env.password)
	require.NoError(t, err)

	// 第一次 refresh 应当成功
	newAccess1, err := env.svc.Refresh(context.Background(), refresh)
	require.NoError(t, err)
	assert.NotEmpty(t, newAccess1)

	// 重放：用同一个旧 refresh 再 Refresh 应当被 rotate_refresh_token 函数检测
	_, err = env.svc.Refresh(context.Background(), refresh)
	assert.ErrorIs(t, err, services.ErrInvalidRefreshToken,
		"旧 refresh 在第一次 rotate 后已 revoked，重放必须被拒")
}

func TestAuth_RefreshInvalidToken(t *testing.T) {
	env := setupAuthEnv(t)
	defer env.cleanup()

	_, err := env.svc.Refresh(context.Background(), "totally-not-a-jwt")
	assert.ErrorIs(t, err, services.ErrInvalidRefreshToken)
}

// ------------------------------------------------------------
// Logout：token_version 自增；旧 access 因 version 不匹配被拒
// ------------------------------------------------------------

func TestAuth_LogoutInvalidatesAccess(t *testing.T) {
	env := setupAuthEnv(t)
	defer env.cleanup()

	access, refresh, _, err := env.svc.Login(context.Background(), env.username, env.password)
	require.NoError(t, err)

	// 校验登出前 access 可用
	_, err = env.svc.VerifyAccessToken(context.Background(), access)
	require.NoError(t, err)

	// 登出
	err = env.svc.Logout(context.Background(), services.AuthContext{
		UserID: env.userID, RoleID: env.roleID,
	})
	require.NoError(t, err)

	// 登出后旧 access 必须被拒
	_, err = env.svc.VerifyAccessToken(context.Background(), access)
	assert.ErrorIs(t, err, services.ErrInvalidAccessToken,
		"logout 后旧 access token 因 token_version 不匹配应被拒")

	// 登出后旧 refresh 也应被 rotate_refresh_token 视为 revoked
	_, err = env.svc.Refresh(context.Background(), refresh)
	assert.ErrorIs(t, err, services.ErrInvalidRefreshToken,
		"logout 后旧 refresh 因已 revoked 应被拒")
}

// ------------------------------------------------------------
// Me：从 ctx 拿身份后返回用户信息
// ------------------------------------------------------------

func TestAuth_Me(t *testing.T) {
	env := setupAuthEnv(t)
	defer env.cleanup()

	raw, err := env.svc.Me(context.Background(), services.AuthContext{
		UserID: env.userID, RoleID: env.roleID,
	})
	require.NoError(t, err)
	user, ok := raw.(services.AuthUser)
	require.True(t, ok)
	assert.Equal(t, env.userID, user.ID)
	assert.Equal(t, env.username, user.Username)
}

// ------------------------------------------------------------
// WS ticket：签发 + 一次性消费 + 重放拒绝
// ------------------------------------------------------------

func TestAuth_WSTicketRoundtrip(t *testing.T) {
	env := setupAuthEnv(t)
	defer env.cleanup()

	sc := services.AuthContext{UserID: env.userID, RoleID: env.roleID}
	ticket, expiresAt, err := env.svc.IssueWSTicket(context.Background(), sc)
	require.NoError(t, err)
	require.NotEmpty(t, ticket)
	assert.True(t, expiresAt.After(time.Now()))

	// 一次性消费
	verified, err := env.svc.VerifyWSTicket(context.Background(), ticket)
	require.NoError(t, err)
	ac, ok := verified.(services.AuthContext)
	require.True(t, ok)
	assert.Equal(t, env.userID, ac.UserID)
	assert.Equal(t, env.roleID, ac.RoleID)

	// 重放：同一 ticket 第二次 verify 必须失败（consume_ws_ticket 已 set used_at）
	_, err = env.svc.VerifyWSTicket(context.Background(), ticket)
	assert.ErrorIs(t, err, services.ErrInvalidWSTicket,
		"WS ticket 一次性，重放必须被拒")
}

func TestAuth_WSTicketInvalid(t *testing.T) {
	env := setupAuthEnv(t)
	defer env.cleanup()

	_, err := env.svc.VerifyWSTicket(context.Background(), "not-a-valid-ticket")
	assert.ErrorIs(t, err, services.ErrInvalidWSTicket)

	_, err = env.svc.VerifyWSTicket(context.Background(), "")
	assert.ErrorIs(t, err, services.ErrInvalidWSTicket)
}

// ------------------------------------------------------------
// 用户禁用：is_active=false 的用户登录返回 ErrUserInactive；
//           access token 校验时也返回 ErrUserInactive
// ------------------------------------------------------------

func TestAuth_InactiveUserRejected(t *testing.T) {
	env := setupAuthEnv(t)
	defer env.cleanup()

	// access 先签发 → 直接在 DB 改 is_active=FALSE → 再 Verify
	access, _, _, err := env.svc.Login(context.Background(), env.username, env.password)
	require.NoError(t, err)

	_, err = env.pool.Exec(context.Background(),
		`UPDATE users SET is_active = FALSE WHERE id = $1`, env.userID)
	require.NoError(t, err)

	// 已签发 access 在 VerifyAccessToken 时应被识别为 inactive
	_, err = env.svc.VerifyAccessToken(context.Background(), access)
	assert.ErrorIs(t, err, services.ErrUserInactive)

	// 再次尝试 Login 也返回 inactive
	_, _, _, err = env.svc.Login(context.Background(), env.username, env.password)
	assert.ErrorIs(t, err, services.ErrUserInactive)
}
