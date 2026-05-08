/*
@file rls_payments_test.go
@description payments_insert RLS 收紧测试（finding #17）。

             业务背景：
               - 旧 policy 让项目成员 A 可写 direction='dev_settlement' + related_user_id=B，
                 伪造给同事 B 制造虚假结算入账。
               - 0025 migration 收紧：dev_settlement 仅 admin 可走；普通成员仅 customer_in。

             测试约束：
               - testutil 用 postgres 超级用户连接，BYPASSRLS 隐式生效；
                 必须 SET LOCAL ROLE progress_app 切到受 RLS 约束的角色才能验证 policy
               - 用 InTx + SetSessionContext 注入 app.user_id / app.role_id GUC
               - 失败时 PG 报 "new row violates row-level security policy"
@author Atlas.oi
@date 2026-05-08
*/

package integration

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"github.com/ghostterm/progress-server/internal/auth"
	progressdb "github.com/ghostterm/progress-server/internal/db"
	"github.com/ghostterm/progress-server/internal/services"
	"github.com/ghostterm/progress-server/internal/testutil"
)

// encryptRemark 用 testutil.TestCipherKey 派生 payments_remark 子密钥加密 plaintext。
// 0026 后 payments.remark 是 BYTEA，raw INSERT 不能直接传 TEXT 字面量。
func encryptRemark(t *testing.T, ctx context.Context, pool *pgxpool.Pool, plaintext string) []byte {
	t.Helper()
	cs, err := services.NewCipherService(pool, []byte(testutil.TestCipherKey))
	require.NoError(t, err)
	enc, err := cs.Encrypt(ctx, "payments_remark", plaintext)
	require.NoError(t, err)
	return enc
}

// rlsPaymentsEnv 装配 payments RLS 测试所需的最小用户与项目集合。
type rlsPaymentsEnv struct {
	pool             *pgxpool.Pool
	cleanup          func()
	adminID          int64 // role_id=1，super_admin
	devAID           int64 // role_id=2，project_member
	devBID           int64 // role_id=2，project_member（攻击目标）
	projectID        int64
	screenshotFileID int64 // dev_settlement 必填的 screenshot_id
}

func setupRLSPaymentsEnv(t *testing.T) *rlsPaymentsEnv {
	t.Helper()
	pool, cleanup := testutil.StartPostgres(t)

	hash, err := auth.HashPassword("password", bcrypt.MinCost)
	require.NoError(t, err)

	ctx := context.Background()

	// 1. 用户：复用 0001 已 INSERT 的 admin（避免 users_super_admin_unique 冲突）
	var adminID, devAID, devBID int64
	require.NoError(t, pool.QueryRow(ctx, `
		SELECT id FROM users WHERE role_id = 1 LIMIT 1
	`).Scan(&adminID))
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, display_name, role_id, is_active)
		VALUES ('dev-a-rls-pay', $1, 'DevA', 2, TRUE)
		RETURNING id
	`, hash).Scan(&devAID))
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, display_name, role_id, is_active)
		VALUES ('dev-b-rls-pay', $1, 'DevB', 2, TRUE)
		RETURNING id
	`, hash).Scan(&devBID))

	// 2. 项目：admin 创建（recorded_by 必填外键）
	var projectID int64
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO projects (name, customer_label, description, deadline, created_by)
		VALUES ('RLSPayProject', 'TestCustomer', 'desc', NOW() + INTERVAL '30 days', $1)
		RETURNING id
	`, adminID).Scan(&projectID))

	// 3. devA + devB 都加入 project_members（让 is_member() 返 true）
	_, err = pool.Exec(ctx, `
		INSERT INTO project_members (project_id, user_id, role)
		VALUES ($1, $2, 'dev'), ($1, $3, 'dev')
	`, projectID, devAID, devBID)
	require.NoError(t, err)

	// 4. screenshot 文件（dev_settlement 必填的 screenshot_id 引用）
	var fileID int64
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO files (uuid, filename, size_bytes, mime_type, storage_path, uploaded_by)
		VALUES (gen_random_uuid(), 'rls-pay.png', 1024, 'image/png',
		        '/tmp/rls-pay-' || extract(epoch from now())::text || '.png', $1)
		RETURNING id
	`, adminID).Scan(&fileID))

	return &rlsPaymentsEnv{
		pool:             pool,
		cleanup:          cleanup,
		adminID:          adminID,
		devAID:           devAID,
		devBID:           devBID,
		projectID:        projectID,
		screenshotFileID: fileID,
	}
}

// insertPaymentAsRole 在事务内 SET LOCAL ROLE progress_app + 注入 GUC 后，
// 以指定用户身份 INSERT payments 行；返回 PG 实际响应（含 RLS 拒绝错误）。
//
// 业务背景：
//   - testutil pool 是 postgres 超级用户，FORCE RLS 对 superuser 仍无效；
//     必须切到 progress_app（NOBYPASSRLS）才能让 0025 policy 真正过 WITH CHECK
//   - SetSessionContext 让 helper is_admin()/is_member() 能读到当前会话身份
//   - 事务 commit/rollback 后 SET LOCAL 自动失效，连接归还池干净
func insertPaymentAsRole(
	ctx context.Context,
	pool *pgxpool.Pool,
	userID, roleID int64,
	insertSQL string,
	args ...any,
) error {
	return progressdb.InTx(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SET LOCAL ROLE progress_app`); err != nil {
			return err
		}
		if err := progressdb.SetSessionContext(ctx, tx, userID, roleID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, insertSQL, args...)
		return err
	})
}

// ============================================================
// 1. 攻击场景：devA 试图给 devB 制造虚假 dev_settlement 入账
//    新 policy 必须拒绝（is_admin() 为 false，且 direction != 'customer_in'）
// ============================================================

func TestPaymentsRLS_NonAdminCannotInsertDevSettlement(t *testing.T) {
	env := setupRLSPaymentsEnv(t)
	defer env.cleanup()

	ctx := context.Background()

	// devA（role 2）伪造 dev_settlement 给 devB
	// 0026 后 remark 是 BYTEA：用 cipher 加密后 INSERT；本测试关注 RLS 拒绝路径，
	// remark 字段是否能写入不影响 policy 判定（policy 看 direction + is_admin）
	encRemark := encryptRemark(t, ctx, env.pool, "虚假结算攻击")
	err := insertPaymentAsRole(ctx, env.pool, env.devAID, 2, `
		INSERT INTO payments
			(project_id, direction, amount, paid_at, related_user_id, screenshot_id, remark, recorded_by)
		VALUES ($1, 'dev_settlement', 100.00, NOW(), $2, $3, $4, $5)
	`, env.projectID, env.devBID, env.screenshotFileID, encRemark, env.devAID)

	require.Error(t, err, "0025 policy 必须拒绝普通成员写 dev_settlement")
	assert.True(t,
		strings.Contains(err.Error(), "row-level security policy") ||
			strings.Contains(err.Error(), "row violates row-level security"),
		"应是 RLS 拒绝错误，实际：%v", err)
}

// ============================================================
// 2. admin 仍可写 dev_settlement（合法路径）
// ============================================================

func TestPaymentsRLS_AdminCanInsertDevSettlement(t *testing.T) {
	env := setupRLSPaymentsEnv(t)
	defer env.cleanup()

	ctx := context.Background()

	// admin（role 1）合法写入 dev_settlement
	encRemark := encryptRemark(t, ctx, env.pool, "合法结算")
	err := insertPaymentAsRole(ctx, env.pool, env.adminID, 1, `
		INSERT INTO payments
			(project_id, direction, amount, paid_at, related_user_id, screenshot_id, remark, recorded_by)
		VALUES ($1, 'dev_settlement', 100.00, NOW(), $2, $3, $4, $5)
	`, env.projectID, env.devAID, env.screenshotFileID, encRemark, env.adminID)

	require.NoError(t, err, "admin 应可写 dev_settlement，实际：%v", err)
}

// ============================================================
// 3. 普通成员仍可写 customer_in（业务正常路径）
//    防止本次收紧误伤 CS 录入客户回款的合法场景
// ============================================================

func TestPaymentsRLS_NonAdminCanInsertCustomerIn(t *testing.T) {
	env := setupRLSPaymentsEnv(t)
	defer env.cleanup()

	ctx := context.Background()

	// devA（role 2，is_member）合法写入 customer_in
	encRemark := encryptRemark(t, ctx, env.pool, "客户回款")
	err := insertPaymentAsRole(ctx, env.pool, env.devAID, 2, `
		INSERT INTO payments
			(project_id, direction, amount, paid_at, remark, recorded_by)
		VALUES ($1, 'customer_in', 200.00, NOW(), $2, $3)
	`, env.projectID, encRemark, env.devAID)

	require.NoError(t, err, "普通成员应可写 customer_in，实际：%v", err)

	// 即便附带 paid_at 等小时级时间戳，policy 仅看 direction + is_member，
	// 不该拒绝；用 helper 的下一秒做幂等性占位
	_ = time.Second
}
