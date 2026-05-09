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
	// 注（2026-05-04）：Refresh 签名升级为 (access, newRefresh, error)；本用例不用新 refresh
	newAccess1, _, err := env.svc.Refresh(context.Background(), refresh)
	require.NoError(t, err)
	assert.NotEmpty(t, newAccess1)

	// 重放：用同一个旧 refresh 再 Refresh
	// finding M1：rotate 后 reason='used'，第二次使用是合法生命周期重放（client race），
	// 返 ErrInvalidRefreshToken 不再误踢全会话。真 reuse 由"reason IS NULL 历史命中"路径
	// 单独触发（见 TestAuth_RefreshLegacyRevokedNoReasonTriggersReuseFullKill）。
	_, _, err = env.svc.Refresh(context.Background(), refresh)
	assert.ErrorIs(t, err, services.ErrInvalidRefreshToken,
		"finding M1：rotate 后旧 RT 重放是 lifecycle replay，返 invalid 不返 reuse")
}

func TestAuth_RefreshInvalidToken(t *testing.T) {
	env := setupAuthEnv(t)
	defer env.cleanup()

	// 完全没注册过的 token（JWT 校验直接失败）→ ErrInvalidRefreshToken
	// 与 ErrRefreshTokenReused 区分：reuse 是历史中存在过；invalid 是从未存在
	_, _, err := env.svc.Refresh(context.Background(), "totally-not-a-jwt")
	assert.ErrorIs(t, err, services.ErrInvalidRefreshToken)
	assert.NotErrorIs(t, err, services.ErrRefreshTokenReused,
		"完全无效 token 不应触发 reuse 检测路径")
}

// ------------------------------------------------------------
// Refresh token reuse 检测（finding #8 + finding M1）
//
// finding #8 之前：旧 token 第二次使用 → 撤销该 user 全部 refresh_tokens + bump token_version
// finding M1 之后：rotate 后旧 RT 标 reason='used' 的"重放"是合法生命周期场景（race / 重试），
//                  返 ErrInvalidRefreshToken 不全踢。真 reuse 仅在 reason IS NULL 历史命中
//                  时触发（legacy 数据 + 极端竞态）。
// ------------------------------------------------------------

// TestAuth_RefreshRotatedTokenSecondUseIsLifecycleReplay 验证 finding M1：
// rotate 后旧 RT (reason='used') 第二次使用 = 合法生命周期重放，不全踢其它会话。
//
// 业务背景：StrictMode 双 mount / cleanup 重试 / 客户端 race 都会让同一 RT 被消费两次，
// 这是合法的客户端行为；不该被错认为攻击。
func TestAuth_RefreshRotatedTokenSecondUseIsLifecycleReplay(t *testing.T) {
	env := setupAuthEnv(t)
	defer env.cleanup()
	ctx := context.Background()

	// 登录两次模拟两端会话
	_, refresh1, _, err := env.svc.Login(ctx, env.username, env.password)
	require.NoError(t, err)
	_, refresh2, _, err := env.svc.Login(ctx, env.username, env.password)
	require.NoError(t, err)
	assert.NotEqual(t, refresh1, refresh2)

	var tvBefore int64
	require.NoError(t, env.pool.QueryRow(ctx,
		`SELECT token_version FROM users WHERE id=$1`, env.userID).Scan(&tvBefore))

	// 第一次 rotate：refresh1 → reason='used'，新 RT newRefresh1 入库
	_, newRefresh1, err := env.svc.Refresh(ctx, refresh1)
	require.NoError(t, err)
	require.NotEmpty(t, newRefresh1)

	// 第二次用同一旧 refresh1（race 场景）—— finding M1 后是合法生命周期重放
	_, _, err = env.svc.Refresh(ctx, refresh1)
	assert.ErrorIs(t, err, services.ErrInvalidRefreshToken,
		"reason='used' 的旧 RT 重放是 lifecycle race，应返 invalid 不全踢")
	assert.NotErrorIs(t, err, services.ErrRefreshTokenReused,
		"finding M1：rotation race 不再误踢全会话")

	// 关键不变量：token_version 不 bump
	var tvAfter int64
	require.NoError(t, env.pool.QueryRow(ctx,
		`SELECT token_version FROM users WHERE id=$1`, env.userID).Scan(&tvAfter))
	assert.Equal(t, tvBefore, tvAfter, "lifecycle replay 不 bump token_version")

	// refresh2（其它设备会话）应保持 active
	var rt2Revoked bool
	require.NoError(t, env.pool.QueryRow(ctx,
		`SELECT revoked_at IS NOT NULL FROM refresh_tokens WHERE token_hash = $1`,
		auth.HashRefreshToken(refresh2)).Scan(&rt2Revoked))
	assert.False(t, rt2Revoked, "refresh2（其它设备）不应被误踢")

	// newRefresh1 仍可用（race 不影响新 RT 的合法性）
	_, _, err = env.svc.Refresh(ctx, newRefresh1)
	assert.NoError(t, err, "rotate 拿到的新 RT 仍可继续 rotate")
}

// TestAuth_RefreshLegacyRevokedNoReasonTriggersReuseFullKill 验证：legacy 数据
// （revoke 但 reason IS NULL）走 rotate 函数路径 2，触发全踢。
//
// 业务背景：0029 之前 revoke 的 refresh_tokens 行无 reason 标记；保留对这类
// 历史数据的最严格防御 —— 既然没有标记说明是合法登出还是攻击，按攻击处理。
func TestAuth_RefreshLegacyRevokedNoReasonTriggersReuseFullKill(t *testing.T) {
	env := setupAuthEnv(t)
	defer env.cleanup()
	ctx := context.Background()

	_, refresh1, _, err := env.svc.Login(ctx, env.username, env.password)
	require.NoError(t, err)
	_, refresh2, _, err := env.svc.Login(ctx, env.username, env.password)
	require.NoError(t, err)

	var tvBefore int64
	require.NoError(t, env.pool.QueryRow(ctx,
		`SELECT token_version FROM users WHERE id=$1`, env.userID).Scan(&tvBefore))

	// 模拟 legacy 数据：手动把 refresh1 标 revoked 但 reason IS NULL
	_, err = env.pool.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = NOW(), revocation_reason = NULL WHERE token_hash = $1`,
		auth.HashRefreshToken(refresh1))
	require.NoError(t, err)

	// 用 refresh1 调 refresh：historicalTokenReason 返 (nil, true) → 走 rotate 函数路径 2 全踢
	_, _, err = env.svc.Refresh(ctx, refresh1)
	require.ErrorIs(t, err, services.ErrRefreshTokenReused,
		"legacy revoked 但 reason IS NULL 行应保守按 reuse 攻击处理")

	// 验证 token_version 已 bump
	var tvAfter int64
	require.NoError(t, env.pool.QueryRow(ctx,
		`SELECT token_version FROM users WHERE id=$1`, env.userID).Scan(&tvAfter))
	assert.Greater(t, tvAfter, tvBefore, "legacy reuse 路径应 bump token_version 全踢")

	// refresh2（无辜 active 会话）应被全踢
	var rt2Revoked bool
	require.NoError(t, env.pool.QueryRow(ctx,
		`SELECT revoked_at IS NOT NULL FROM refresh_tokens WHERE token_hash = $1`,
		auth.HashRefreshToken(refresh2)).Scan(&rt2Revoked))
	assert.True(t, rt2Revoked, "legacy reuse 触发的全踢应包含其它 active RT")
}

func TestAuth_RefreshReuseSentinelDistinctFromInvalid(t *testing.T) {
	env := setupAuthEnv(t)
	defer env.cleanup()
	ctx := context.Background()

	// case 1：完全无效 token（JWT 解析失败）→ ErrInvalidRefreshToken
	_, _, err := env.svc.Refresh(ctx, "garbage-not-a-jwt-xyz")
	assert.ErrorIs(t, err, services.ErrInvalidRefreshToken)
	assert.NotErrorIs(t, err, services.ErrRefreshTokenReused)

	// case 2：JWT 合法但 hash 在 DB 没记录（攻击者伪造已过期但签名合法的 token）
	// 此场景下 JWT verify 通过，但 rotate_refresh_token 找不到任何记录 → ErrInvalidRefreshToken
	// 这里我们用 IssueRefreshToken 拿一个签名合法的 token 但不 INSERT DB
	rawToken, _, err := auth.IssueRefreshToken(env.userID, []byte("test-refresh-secret-32-bytes-min!"), 24*time.Hour)
	require.NoError(t, err)
	_, _, err = env.svc.Refresh(ctx, rawToken)
	assert.ErrorIs(t, err, services.ErrInvalidRefreshToken,
		"JWT 合法但 hash 从未入库 → 完全无效，不是 reuse")
	assert.NotErrorIs(t, err, services.ErrRefreshTokenReused)
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

	// finding M1：logout 后旧 refresh 不再走"全踢"路径
	//
	// 0029 给 refresh_tokens 加 revocation_reason 列，logout 写入 reason='logout'。
	// Refresh 路径检测到该 reason 就识别为"合法生命周期重放"——返 ErrInvalidRefreshToken
	// 而非 ErrRefreshTokenReused，不 bump token_version、不全踢其它会话。
	//
	// 这避免了客户端 race（StrictMode 双 mount / cleanup 重试 / 多端登出冲突）
	// 在 logout 后用旧 RT 调 refresh 把无辜会话误杀的问题。
	_, _, err = env.svc.Refresh(context.Background(), refresh)
	assert.ErrorIs(t, err, services.ErrInvalidRefreshToken,
		"logout 后旧 refresh reason='logout' 是合法重放，应返 invalid 不全踢")
	assert.NotErrorIs(t, err, services.ErrRefreshTokenReused,
		"logout race 不应被误判为 reuse 攻击")
}

// ------------------------------------------------------------
// finding M1：logout 后旧 refresh 复用不应误踢其它会话
// ------------------------------------------------------------

func TestAuth_LogoutThenReuseDoesNotKillOtherSessions(t *testing.T) {
	env := setupAuthEnv(t)
	defer env.cleanup()
	ctx := context.Background()

	// 设备 A 和 B 各登录一次（模拟多端会话）
	_, refreshA, _, err := env.svc.Login(ctx, env.username, env.password)
	require.NoError(t, err)
	_, refreshB, _, err := env.svc.Login(ctx, env.username, env.password)
	require.NoError(t, err)

	// 记录登出前的 token_version 与设备 B 的 access 状态
	var tvBefore int64
	require.NoError(t, env.pool.QueryRow(ctx,
		`SELECT token_version FROM users WHERE id=$1`, env.userID).Scan(&tvBefore))

	// 设备 A 登出
	require.NoError(t, env.svc.Logout(ctx, services.AuthContext{
		UserID: env.userID, RoleID: env.roleID,
	}))

	// 设备 A 客户端因 race / 重试 / cleanup 再用旧 refreshA 调 refresh
	_, _, err = env.svc.Refresh(ctx, refreshA)
	assert.ErrorIs(t, err, services.ErrInvalidRefreshToken,
		"logout 后旧 RT 重放是合法生命周期，必须返 invalid 不返 reuse")

	// 验证：设备 B 的 refresh 在 DB 中应仍 active（reason IS NULL）—— 不被误踢
	// 注意 logout 已 revoke 当前 user 全部 RT（含 B），但 reason='logout'
	// reuse_detected 路径会把所有 active RT 全 revoke + bump token_version；
	// 本测试要验证的是 token_version 不变（logout race 路径不踢全）
	var tvAfter int64
	require.NoError(t, env.pool.QueryRow(ctx,
		`SELECT token_version FROM users WHERE id=$1`, env.userID).Scan(&tvAfter))
	assert.Equal(t, tvBefore+1, tvAfter,
		"token_version 仅 logout 时 +1，refresh race 不应再次 bump（finding M1）")

	// refreshB 在 DB 中也应是 reason='logout'（被 logout 全部 revoke）而非 reuse_detected
	var reasonB *string
	require.NoError(t, env.pool.QueryRow(ctx,
		`SELECT revocation_reason FROM refresh_tokens WHERE token_hash = $1`,
		auth.HashRefreshToken(refreshB)).Scan(&reasonB))
	require.NotNil(t, reasonB)
	assert.Equal(t, "logout", *reasonB,
		"logout 路径写入的 reason 必须是 'logout'，便于 reuse 检测分流")
}

// TestAuth_RotatedTokenReplayAfterRotateMarksUsed 验证：成功 rotate 后旧 RT 第二次使用
// 走"used 重放"路径，不再走全踢（finding M1 正向案例：与 logout race 同语义）。
func TestAuth_RotatedTokenReplayAfterRotateMarksUsed(t *testing.T) {
	env := setupAuthEnv(t)
	defer env.cleanup()
	ctx := context.Background()

	_, refresh, _, err := env.svc.Login(ctx, env.username, env.password)
	require.NoError(t, err)

	// 第一次 rotate 成功，旧 refresh 标 reason='used'
	_, _, err = env.svc.Refresh(ctx, refresh)
	require.NoError(t, err)

	// 验证旧 refresh 的 reason='used'
	var reason *string
	require.NoError(t, env.pool.QueryRow(ctx,
		`SELECT revocation_reason FROM refresh_tokens WHERE token_hash = $1`,
		auth.HashRefreshToken(refresh)).Scan(&reason))
	require.NotNil(t, reason)
	assert.Equal(t, "used", *reason,
		"rotate 路径 1 必须把旧 RT 标 reason='used'（0029 函数升级）")

	// 第二次用同一旧 refresh —— finding M1 之后这是"合法生命周期重放"
	// （StrictMode 双 mount race 场景）应返 invalid 不全踢
	var tvBefore int64
	require.NoError(t, env.pool.QueryRow(ctx,
		`SELECT token_version FROM users WHERE id=$1`, env.userID).Scan(&tvBefore))

	_, _, err = env.svc.Refresh(ctx, refresh)
	assert.ErrorIs(t, err, services.ErrInvalidRefreshToken,
		"已 rotate 旧 RT 重放走 used 分支，返 invalid 不返 reuse")
	assert.NotErrorIs(t, err, services.ErrRefreshTokenReused,
		"used 重放不该触发 reuse 全踢")

	var tvAfter int64
	require.NoError(t, env.pool.QueryRow(ctx,
		`SELECT token_version FROM users WHERE id=$1`, env.userID).Scan(&tvAfter))
	assert.Equal(t, tvBefore, tvAfter,
		"used 重放不 bump token_version（finding M1 关键不变量）")
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

// ------------------------------------------------------------
// finding #18: password_hash IS NULL 表示"尚未设置密码"，Login 必须拒登
//              并返回 ErrPasswordNotSet，前端据此引导首次设置流程。
//              0021 migration 把 0001 默认 admin 的 hash 置 NULL，
//              防止公开仓库默认密码 admin/admin123 在生产部署被遗忘改密。
// ------------------------------------------------------------

func TestAuth_LoginRejectsNullPasswordHash(t *testing.T) {
	env := setupAuthEnv(t)
	defer env.cleanup()

	// 把 seed 用户的 password_hash 置 NULL，模拟 0021 migration 后的 admin
	_, err := env.pool.Exec(context.Background(),
		`UPDATE users SET password_hash = NULL WHERE id = $1`, env.userID)
	require.NoError(t, err)

	// Login 必须返 ErrPasswordNotSet 而非 ErrInvalidCredentials
	// 区分意义：前端拿到 password_not_set code 才能展示"请联系管理员首次设置"提示
	_, _, _, err = env.svc.Login(context.Background(), env.username, "anything")
	assert.ErrorIs(t, err, services.ErrPasswordNotSet,
		"NULL password_hash 必须返 ErrPasswordNotSet，让前端识别首次设置场景")
}
