/*
@file feedback_test.go
@description FeedbackHandler 权限校验测试 —— 验证 finding #16 修复后：
             handler 走 EffectivePermissionsService（同 PermissionsHandler pattern），
             user_permissions 表的 grant/deny override 对 3 个 feedback endpoint 真正生效。

             覆盖：
              1. AdminWildcardCanList: super_admin (*:*) 哨兵能查 feedbacks
              2. DevWithRolePermsCanList: dev 角色默认有 progress:feedback:list 能查
              3. UserPermDenyBlocksList: dev 用户加 progress:feedback:list deny override → 空列表
              4. UserPermDenyBlocksCreate: dev 用户加 progress:feedback:create deny → 422 (无权)
              5. UserPermDenyBlocksUpdate: dev 用户加 progress:feedback:update deny → 404 (无权)

             本文件 *仅* 验证权限校验路径；service 层的 RLS / source / status 等业务路径
             由 tests/integration/feedback_test.go 覆盖，避免重复。

@author Atlas.oi
@date 2026-05-08
*/

package handlers_test

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"github.com/ghostterm/progress-server/internal/api/handlers"
	"github.com/ghostterm/progress-server/internal/api/middleware"
	"github.com/ghostterm/progress-server/internal/api/oas"
	"github.com/ghostterm/progress-server/internal/auth"
	"github.com/ghostterm/progress-server/internal/services"
	"github.com/ghostterm/progress-server/tests/fixtures"
)

// feedbackTestEnv 装配 feedback handler 测试需要的最小环境：
//   - admin 用户（super_admin role）
//   - dev 用户（role_id=2, 默认有 progress:feedback:list/create）
//   - 一个 project（admin 创建，dev 是 member）
type feedbackHandlerEnv struct {
	tdb       *fixtures.TestDB
	handler   *handlers.FeedbackHandler
	effSvc    services.EffectivePermissionsService
	adminID   int64
	devID     int64
	projectID int64
}

func setupFeedbackHandlerEnv(t *testing.T) *feedbackHandlerEnv {
	t.Helper()
	tdb := fixtures.NewTestDB(t)
	t.Cleanup(tdb.Close)

	ctx := context.Background()

	// admin 已由 0001 migration 预置；直接 SELECT 复用
	var adminID int64
	require.NoError(t, tdb.Pool.QueryRow(ctx, `SELECT id FROM users WHERE role_id = 1 LIMIT 1`).Scan(&adminID))

	// dev 用户
	hash, err := auth.HashPassword("password", bcrypt.MinCost)
	require.NoError(t, err)
	uname := fmt.Sprintf("fbh-dev-%d", testRandUint())
	var devID int64
	err = tdb.Pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, display_name, role_id, is_active)
		VALUES ($1, $2, 'FB Handler Dev', 2, TRUE)
		RETURNING id
	`, uname, hash).Scan(&devID)
	require.NoError(t, err)

	// project：admin 创建 + dev 加为 member（让 RLS 通过）
	projectID := fixtures.SeedProject(t, ctx, tdb.Pool, adminID)
	_, err = tdb.Pool.Exec(ctx, `
		INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'dev')
	`, projectID, devID)
	require.NoError(t, err)

	// services + handler
	notifSvc, err := services.NewNotificationService(services.NotificationServiceDeps{
		Pool: tdb.Pool, Hub: services.NewWSHub(),
	})
	require.NoError(t, err)
	fbSvc, err := services.NewFeedbackService(services.FeedbackServiceDeps{
		Pool: tdb.Pool, NotificationService: notifSvc,
	})
	require.NoError(t, err)
	rbacSvc, err := services.NewRBACService(services.RBACServiceDeps{Pool: tdb.Pool})
	require.NoError(t, err)
	effSvc := services.NewEffectivePermissionsService(tdb.Pool)

	h, err := handlers.NewFeedbackHandler(fbSvc, rbacSvc, effSvc)
	require.NoError(t, err)

	return &feedbackHandlerEnv{
		tdb: tdb, handler: h, effSvc: effSvc,
		adminID: adminID, devID: devID, projectID: projectID,
	}
}

// ctxWithUserPerms 装上 AuthContext + 真实计算的 effective perms（与 oasSecurityHandler 一致）。
func (e *feedbackHandlerEnv) ctxWithUserPerms(t *testing.T, userID, roleID int64) context.Context {
	t.Helper()
	ctx := context.Background()
	perms, err := e.effSvc.Compute(ctx, userID)
	require.NoError(t, err)
	ctx = middleware.WithAuthContext(ctx, services.AuthContext{UserID: userID, RoleID: roleID})
	ctx = middleware.WithEffectivePermissions(ctx, perms)
	return ctx
}

// insertDeny 给目标用户加一条 perm deny override。
// permCode 形如 "progress:feedback:list"。
func insertDeny(t *testing.T, ctx context.Context, pool *pgxpool.Pool, byUserID, targetUserID int64, permCode string) {
	t.Helper()
	parts := strings.Split(permCode, ":")
	require.Len(t, parts, 3, "permCode 必须是 3 段 resource:action:scope")

	var permID int64
	err := pool.QueryRow(ctx, `
		SELECT id FROM permissions WHERE resource=$1 AND action=$2 AND scope=$3
	`, parts[0], parts[1], parts[2]).Scan(&permID)
	require.NoError(t, err, "permission %s 必须已存在", permCode)

	_, err = pool.Exec(ctx, `
		INSERT INTO user_permissions (user_id, permission_id, effect, created_by)
		VALUES ($1, $2, 'deny', $3)
	`, targetUserID, permID, byUserID)
	require.NoError(t, err)
}

// ============================================================
// 1. AdminWildcardCanList: super_admin (*:*) 能查 feedbacks
// ============================================================

func TestFeedbackHandler_AdminWildcardCanList(t *testing.T) {
	env := setupFeedbackHandlerEnv(t)

	ctx := env.ctxWithUserPerms(t, env.adminID, 1)
	resp, err := env.handler.ProjectsListFeedbacks(ctx, oas.ProjectsListFeedbacksParams{ID: env.projectID})
	require.NoError(t, err)
	require.NotNil(t, resp)
	// 列表为空但 Data 字段必须是 [] 而非 nil
	assert.NotNil(t, resp.Data)
}

// ============================================================
// 2. DevWithRolePermsCanList: dev 默认有 progress:feedback:list
// ============================================================

func TestFeedbackHandler_DevWithRolePermsCanList(t *testing.T) {
	env := setupFeedbackHandlerEnv(t)

	ctx := env.ctxWithUserPerms(t, env.devID, 2)
	resp, err := env.handler.ProjectsListFeedbacks(ctx, oas.ProjectsListFeedbacksParams{ID: env.projectID})
	require.NoError(t, err)
	require.NotNil(t, resp)
	// dev 是 project member 且有 progress:feedback:list；正向路径不应被空列表退化
	assert.NotNil(t, resp.Data)
}

// ============================================================
// 3. UserPermDenyBlocksList: deny override 让 dev list 退化为空数组
// ============================================================
//
// 这是 finding #16 的核心修复证明：之前 handler 走 RBACService.HasPermission（不读 user_permissions），
// 此处 deny 不生效。修复后走 EffectivePermissionsService，deny 必定从 perms 里被扣除，
// 不再命中 progress:feedback:list → handler 退化为 Data=[]。

func TestFeedbackHandler_UserPermDenyBlocksList(t *testing.T) {
	env := setupFeedbackHandlerEnv(t)

	// 先在 DB 写入一条 feedback 让"未拒"路径能区分
	ctx := context.Background()
	fbSvc, _ := services.NewFeedbackService(services.FeedbackServiceDeps{
		Pool: env.tdb.Pool,
		NotificationService: func() services.NotificationService {
			ns, _ := services.NewNotificationService(services.NotificationServiceDeps{
				Pool: env.tdb.Pool, Hub: services.NewWSHub(),
			})
			return ns
		}(),
	})
	_, err := fbSvc.Create(ctx,
		services.AuthContext{UserID: env.adminID, RoleID: 1},
		env.projectID,
		services.CreateFeedbackInput{Content: "deny-test"},
	)
	require.NoError(t, err)

	// 先验证：无 deny 时 dev 能看到 1 条
	devCtx := env.ctxWithUserPerms(t, env.devID, 2)
	respBefore, err := env.handler.ProjectsListFeedbacks(devCtx, oas.ProjectsListFeedbacksParams{ID: env.projectID})
	require.NoError(t, err)
	require.Len(t, respBefore.Data, 1, "dev 默认有 progress:feedback:list 权限，应看到 1 条")

	// 加 deny override
	insertDeny(t, ctx, env.tdb.Pool, env.adminID, env.devID, "progress:feedback:list")

	// 重新计算 perms（生产由 oasSecurityHandler 每次请求时计算，模拟一致）
	devCtxAfter := env.ctxWithUserPerms(t, env.devID, 2)
	respAfter, err := env.handler.ProjectsListFeedbacks(devCtxAfter, oas.ProjectsListFeedbacksParams{ID: env.projectID})
	require.NoError(t, err)
	// finding #16 修复后：handler 检测到无权 → 退化为空数组
	assert.Empty(t, respAfter.Data, "user_permissions deny progress:feedback:list 后应退化为空列表")
}

// ============================================================
// 4. UserPermDenyBlocksCreate: deny progress:feedback:create → 422
// ============================================================

func TestFeedbackHandler_UserPermDenyBlocksCreate(t *testing.T) {
	env := setupFeedbackHandlerEnv(t)

	ctx := context.Background()
	insertDeny(t, ctx, env.tdb.Pool, env.adminID, env.devID, "progress:feedback:create")

	devCtx := env.ctxWithUserPerms(t, env.devID, 2)
	res, err := env.handler.ProjectsCreateFeedback(devCtx,
		&oas.FeedbackCreateRequest{Content: "should-be-denied"},
		oas.ProjectsCreateFeedbackParams{ID: env.projectID})
	require.NoError(t, err)

	// 该 endpoint OAS 错误响应只声明 422，所以无权落到 422 + validation_failed
	envelope, ok := res.(*oas.ErrorEnvelope)
	require.True(t, ok, "deny 后 create 应返回 ErrorEnvelope；实际 %T", res)
	assert.Equal(t, oas.ErrorEnvelopeErrorCodeValidationFailed, envelope.Error.Code,
		"deny 后 create 走 422 validation_failed envelope")
}

// ============================================================
// 5. UserPermDenyBlocksUpdate: deny progress:feedback:update → 404
// ============================================================
//
// FeedbacksUpdate OAS 仅声明 404 错误响应；handler 把"无权"也用 404 envelope 兜底
// （沿用旧代码语义，避免改 OAS schema）。

func TestFeedbackHandler_UserPermDenyBlocksUpdate(t *testing.T) {
	env := setupFeedbackHandlerEnv(t)

	// 先用 admin 建一条 feedback 拿到 id
	ctx := context.Background()
	notifSvc, _ := services.NewNotificationService(services.NotificationServiceDeps{
		Pool: env.tdb.Pool, Hub: services.NewWSHub(),
	})
	fbSvc, _ := services.NewFeedbackService(services.FeedbackServiceDeps{
		Pool: env.tdb.Pool, NotificationService: notifSvc,
	})
	rawF, err := fbSvc.Create(ctx,
		services.AuthContext{UserID: env.adminID, RoleID: 1},
		env.projectID,
		services.CreateFeedbackInput{Content: "for-update-test"},
	)
	require.NoError(t, err)
	f := rawF.(services.Feedback)

	// 给 dev 加 deny progress:feedback:update
	insertDeny(t, ctx, env.tdb.Pool, env.adminID, env.devID, "progress:feedback:update")

	// dev 调 update：应被无权拦截
	devCtx := env.ctxWithUserPerms(t, env.devID, 2)
	doneStatus := oas.NewOptFeedbackStatus(oas.FeedbackStatusDone)
	res, err := env.handler.FeedbacksUpdate(devCtx,
		&oas.FeedbackUpdateRequest{Status: doneStatus},
		oas.FeedbacksUpdateParams{ID: f.ID})
	require.NoError(t, err)

	envelope, ok := res.(*oas.ErrorEnvelope)
	require.True(t, ok, "deny 后 update 应返回 ErrorEnvelope；实际 %T", res)
	assert.Equal(t, oas.ErrorEnvelopeErrorCodeNotFound, envelope.Error.Code,
		"deny 后 update 走 404 envelope（OAS 该 endpoint 仅声明 404）")
}
