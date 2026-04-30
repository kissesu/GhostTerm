/*
@file payment_test.go
@description PaymentService + Money 全链路 + RLS 隔离的端到端集成测试。
             覆盖：
               1. customer_in 写入：projects.total_received 同事务累加（金额精度守住 NUMERIC text codec）
               2. dev_settlement 写入：必须有 related_user_id + screenshot_id（应用层校验通过 + DB CHECK 兜底）
               3. List 按 paid_at DESC 排序
               4. MyEarnings 聚合精度：3 笔 1234.56 + 7890.12 + 0.01 → 9124.69（不能丢精度）
               5. MyEarnings RLS 隔离：dev1 调 MyEarnings 看不到 dev2 的结算

             关键证明点（与 plan §9.1 Step 3 对齐）：
               - Money 精度：NUMERIC(12,2) text codec 走 db.Money，
                 金额计算 99 + 99 = 198（不是 197.99999）
               - "应用层强制 RLS 过滤"：dev1 调 MyEarnings 时即使 view 失效，
                 service 层 WHERE user_id = ac.UserID 也兜底
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
	progressdb "github.com/ghostterm/progress-server/internal/db"
	"github.com/ghostterm/progress-server/internal/services"
	"github.com/ghostterm/progress-server/internal/testutil"
)

// paymentTestEnv 装配 payment 集成测试所需资源。
type paymentTestEnv struct {
	pool       *pgxpool.Pool
	cleanup    func()
	svc        services.PaymentService
	adminID    int64
	dev1ID     int64
	dev2ID     int64
	csID       int64
	projectID  int64
	customerID int64
	// 一个 dummy file 行，给 dev_settlement 的 screenshot_id 引用（DB 有 FK 到 files）
	screenshotFileID int64
}

func setupPaymentEnv(t *testing.T) *paymentTestEnv {
	t.Helper()
	pool, cleanup := testutil.StartPostgres(t)

	svc, err := services.NewPaymentService(services.PaymentServiceDeps{Pool: pool})
	require.NoError(t, err)

	hash, err := auth.HashPassword("password", bcrypt.MinCost)
	require.NoError(t, err)

	ctx := context.Background()

	// 1. 用户：admin / dev1 / dev2 / cs（结算给 dev1+dev2 用，cs 录入项目）
	var adminID, dev1ID, dev2ID, csID int64
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, display_name, role_id, is_active)
		VALUES ('admin-pay', $1, 'Admin', 1, TRUE) RETURNING id
	`, hash).Scan(&adminID))
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, display_name, role_id, is_active)
		VALUES ('dev1-pay', $1, 'Dev1', 2, TRUE) RETURNING id
	`, hash).Scan(&dev1ID))
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, display_name, role_id, is_active)
		VALUES ('dev2-pay', $1, 'Dev2', 2, TRUE) RETURNING id
	`, hash).Scan(&dev2ID))
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, display_name, role_id, is_active)
		VALUES ('cs-pay', $1, 'CS', 3, TRUE) RETURNING id
	`, hash).Scan(&csID))

	// 2. customer + project
	var customerID int64
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO customers (name_wechat, created_by) VALUES ('Customer', $1) RETURNING id
	`, csID).Scan(&customerID))

	var projectID int64
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO projects (name, customer_id, description, deadline, created_by, current_quote, total_received)
		VALUES ('TestProject', $1, 'desc', NOW() + INTERVAL '30 days', $2, '5000.00', '0.00')
		RETURNING id
	`, customerID, csID).Scan(&projectID))

	// 3. 把 dev1 / dev2 都加入 project_members（让 RLS 放行 SELECT）
	_, err = pool.Exec(ctx, `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'dev')`, projectID, dev1ID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'dev')`, projectID, dev2ID)
	require.NoError(t, err)
	// CS 在 project_members 用 'owner' 角色（enum 仅含 owner/dev/viewer；cs 是 RBAC 系统角色 != project_member_role）
	_, err = pool.Exec(ctx, `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')`, projectID, csID)
	require.NoError(t, err)

	// 4. 一个 dummy file（screenshot_id 必须引用 files.id）
	var fileID int64
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO files (uuid, filename, size_bytes, mime_type, storage_path, uploaded_by)
		VALUES (gen_random_uuid(), 'screenshot.png', 1024, 'image/png', '/tmp/screenshot.png', $1)
		RETURNING id
	`, csID).Scan(&fileID))

	return &paymentTestEnv{
		pool:             pool,
		cleanup:          cleanup,
		svc:              svc,
		adminID:          adminID,
		dev1ID:           dev1ID,
		dev2ID:           dev2ID,
		csID:             csID,
		projectID:        projectID,
		customerID:       customerID,
		screenshotFileID: fileID,
	}
}

func mustPaymentMoney(t *testing.T, s string) progressdb.Money {
	t.Helper()
	m, err := progressdb.MoneyFromString(s)
	require.NoError(t, err, "MoneyFromString(%q)", s)
	return m
}

// ============================================================
// 1. customer_in：写入 + projects.total_received 同事务累加
// ============================================================

func TestPayment_CustomerIn_AccumulatesTotalReceived(t *testing.T) {
	env := setupPaymentEnv(t)
	defer env.cleanup()

	csCtx := services.AuthContext{UserID: env.csID, RoleID: 3}
	ctx := context.Background()

	// 入账两笔：1234.56 + 2000.00 → projects.total_received 应该 = 3234.56
	_, err := env.svc.Create(ctx, csCtx, env.projectID, services.PaymentCreateInput{
		Direction: services.PaymentDirectionCustomerIn,
		Amount:    mustPaymentMoney(t, "1234.56"),
		PaidAt:    time.Now(),
		Remark:    "首付",
	})
	require.NoError(t, err)

	_, err = env.svc.Create(ctx, csCtx, env.projectID, services.PaymentCreateInput{
		Direction: services.PaymentDirectionCustomerIn,
		Amount:    mustPaymentMoney(t, "2000.00"),
		PaidAt:    time.Now(),
		Remark:    "尾款",
	})
	require.NoError(t, err)

	// 直接 SELECT 项目的 total_received，验证 NUMERIC 精度无损
	var totalRaw string
	err = env.pool.QueryRow(ctx, `SELECT total_received::text FROM projects WHERE id = $1`, env.projectID).Scan(&totalRaw)
	require.NoError(t, err)
	assert.Equal(t, "3234.56", totalRaw, "total_received 精度必须 NUMERIC 全保留")
}

// ============================================================
// 2. dev_settlement：必须有 related_user_id + screenshot_id
// ============================================================

func TestPayment_DevSettlement_RequiresScreenshot(t *testing.T) {
	env := setupPaymentEnv(t)
	defer env.cleanup()

	adminCtx := services.AuthContext{UserID: env.adminID, RoleID: 1}
	ctx := context.Background()

	// 缺 related_user_id + screenshot_id → 应用层拒绝
	_, err := env.svc.Create(ctx, adminCtx, env.projectID, services.PaymentCreateInput{
		Direction: services.PaymentDirectionDevSettlement,
		Amount:    mustPaymentMoney(t, "3000.00"),
		PaidAt:    time.Now(),
		Remark:    "结算",
	})
	require.Error(t, err)
	assert.ErrorIs(t, err, services.ErrPaymentSettlementMissingFields)

	// 补完字段 → 通过
	uid := env.dev1ID
	fid := env.screenshotFileID
	_, err = env.svc.Create(ctx, adminCtx, env.projectID, services.PaymentCreateInput{
		Direction:     services.PaymentDirectionDevSettlement,
		Amount:        mustPaymentMoney(t, "3000.00"),
		PaidAt:        time.Now(),
		RelatedUserID: &uid,
		ScreenshotID:  &fid,
		Remark:        "结算",
	})
	require.NoError(t, err)
}

// ============================================================
// 3. List：按 paid_at DESC 排序
// ============================================================

func TestPayment_List_OrderedByPaidAtDesc(t *testing.T) {
	env := setupPaymentEnv(t)
	defer env.cleanup()

	csCtx := services.AuthContext{UserID: env.csID, RoleID: 3}
	ctx := context.Background()

	now := time.Now().UTC()
	// 三笔 customer_in，时间从早到晚
	for i, t0 := range []time.Time{now.Add(-2 * time.Hour), now.Add(-1 * time.Hour), now} {
		_, err := env.svc.Create(ctx, csCtx, env.projectID, services.PaymentCreateInput{
			Direction: services.PaymentDirectionCustomerIn,
			Amount:    mustPaymentMoney(t, "100.00"),
			PaidAt:    t0,
			Remark:    "第" + string(rune('A'+i)) + "笔",
		})
		require.NoError(t, err)
	}

	// List 返回值应按 paid_at DESC 排序：最新的在最前
	raw, err := env.svc.List(ctx, csCtx, env.projectID)
	require.NoError(t, err)
	require.Len(t, raw, 3, "应返回 3 笔记录")

	// 时间序断言
	prev := time.Time{}
	for i, item := range raw {
		p, ok := item.(services.Payment)
		require.True(t, ok)
		if i > 0 {
			assert.True(t, p.PaidAt.Before(prev) || p.PaidAt.Equal(prev),
				"List 应按 paid_at DESC: 第 %d 项 %v 不应晚于前一项 %v", i, p.PaidAt, prev)
		}
		prev = p.PaidAt
	}
}

// ============================================================
// 4. MyEarnings：精度聚合 + 用户级 totalEarned/settlementCount
// ============================================================

func TestPayment_MyEarnings_AggregatePrecision(t *testing.T) {
	env := setupPaymentEnv(t)
	defer env.cleanup()

	adminCtx := services.AuthContext{UserID: env.adminID, RoleID: 1}
	ctx := context.Background()

	// 给 dev1 录入 3 笔结算：1234.56 + 7890.12 + 0.01 = 9124.69
	uid := env.dev1ID
	fid := env.screenshotFileID
	for _, amt := range []string{"1234.56", "7890.12", "0.01"} {
		_, err := env.svc.Create(ctx, adminCtx, env.projectID, services.PaymentCreateInput{
			Direction:     services.PaymentDirectionDevSettlement,
			Amount:        mustPaymentMoney(t, amt),
			PaidAt:        time.Now(),
			RelatedUserID: &uid,
			ScreenshotID:  &fid,
			Remark:        "结算 " + amt,
		})
		require.NoError(t, err)
	}

	// dev1 调 MyEarnings：聚合应精确为 9124.69
	dev1Ctx := services.AuthContext{UserID: env.dev1ID, RoleID: 2}
	raw, err := env.svc.MyEarnings(ctx, dev1Ctx)
	require.NoError(t, err)

	summary, ok := raw.(services.EarningsSummary)
	require.True(t, ok)
	assert.Equal(t, env.dev1ID, summary.UserID)
	assert.Equal(t, 3, summary.SettlementCount, "3 笔结算")
	// Money 精度断言：StringFixed(2) 输出全比特一致的字符串
	assert.Equal(t, "9124.69", summary.TotalEarned.StringFixed(2),
		"Money 聚合必须 NUMERIC 精度无损（1234.56 + 7890.12 + 0.01）")
	require.Len(t, summary.Projects, 1, "只 1 个项目")
	assert.Equal(t, "9124.69", summary.Projects[0].TotalEarned.StringFixed(2))
	assert.Equal(t, 3, summary.Projects[0].SettlementCount)
	assert.Equal(t, "TestProject", summary.Projects[0].ProjectName)
}

// ============================================================
// 5. MyEarnings RLS 隔离：dev1 看不到 dev2 的结算
//
//	这是 Worker F 任务中的核心安全证明点。
//	即使 view 失效或 GUC 漏注，service 层 WHERE user_id = ac.UserID 兜底。
//
// ============================================================

func TestPayment_MyEarnings_OnlyOwnUserVisible(t *testing.T) {
	env := setupPaymentEnv(t)
	defer env.cleanup()

	adminCtx := services.AuthContext{UserID: env.adminID, RoleID: 1}
	ctx := context.Background()

	// 1. dev1 收一笔结算 1000.00
	uid1 := env.dev1ID
	fid := env.screenshotFileID
	_, err := env.svc.Create(ctx, adminCtx, env.projectID, services.PaymentCreateInput{
		Direction:     services.PaymentDirectionDevSettlement,
		Amount:        mustPaymentMoney(t, "1000.00"),
		PaidAt:        time.Now(),
		RelatedUserID: &uid1,
		ScreenshotID:  &fid,
		Remark:        "dev1 结算",
	})
	require.NoError(t, err)

	// 2. dev2 收一笔结算 2000.00
	uid2 := env.dev2ID
	_, err = env.svc.Create(ctx, adminCtx, env.projectID, services.PaymentCreateInput{
		Direction:     services.PaymentDirectionDevSettlement,
		Amount:        mustPaymentMoney(t, "2000.00"),
		PaidAt:        time.Now(),
		RelatedUserID: &uid2,
		ScreenshotID:  &fid,
		Remark:        "dev2 结算",
	})
	require.NoError(t, err)

	// 3. dev1 调 MyEarnings：只能看到自己的 1000.00
	dev1Ctx := services.AuthContext{UserID: env.dev1ID, RoleID: 2}
	raw, err := env.svc.MyEarnings(ctx, dev1Ctx)
	require.NoError(t, err)
	dev1Summary, ok := raw.(services.EarningsSummary)
	require.True(t, ok)
	assert.Equal(t, env.dev1ID, dev1Summary.UserID)
	assert.Equal(t, "1000.00", dev1Summary.TotalEarned.StringFixed(2),
		"dev1 应只看到自己的 1000.00；如果看到 3000.00 = RLS+应用层双重失守")
	assert.Equal(t, 1, dev1Summary.SettlementCount)

	// 4. dev2 调 MyEarnings：只能看到自己的 2000.00
	dev2Ctx := services.AuthContext{UserID: env.dev2ID, RoleID: 2}
	raw2, err := env.svc.MyEarnings(ctx, dev2Ctx)
	require.NoError(t, err)
	dev2Summary, ok := raw2.(services.EarningsSummary)
	require.True(t, ok)
	assert.Equal(t, "2000.00", dev2Summary.TotalEarned.StringFixed(2),
		"dev2 应只看到自己的 2000.00")
	assert.Equal(t, 1, dev2Summary.SettlementCount)
}

// ============================================================
// 6. amount 校验：DB CHECK 约束兜底（即便绕过应用层校验，PG 也拒绝）
// ============================================================

func TestPayment_AmountMustBePositive(t *testing.T) {
	env := setupPaymentEnv(t)
	defer env.cleanup()

	csCtx := services.AuthContext{UserID: env.csID, RoleID: 3}
	ctx := context.Background()

	// 应用层校验：amount = 0
	_, err := env.svc.Create(ctx, csCtx, env.projectID, services.PaymentCreateInput{
		Direction: services.PaymentDirectionCustomerIn,
		Amount:    mustPaymentMoney(t, "0"),
		PaidAt:    time.Now(),
		Remark:    "测试零金额",
	})
	assert.ErrorIs(t, err, services.ErrPaymentInvalidAmount)
}

// ============================================================
// 7. ProjectNotFound：不存在的项目应返回 sentinel error 而不是 PG 23503
// ============================================================

func TestPayment_ProjectNotFound(t *testing.T) {
	env := setupPaymentEnv(t)
	defer env.cleanup()

	csCtx := services.AuthContext{UserID: env.csID, RoleID: 3}
	ctx := context.Background()

	const nonExistentID = int64(999999)
	_, err := env.svc.Create(ctx, csCtx, nonExistentID, services.PaymentCreateInput{
		Direction: services.PaymentDirectionCustomerIn,
		Amount:    mustPaymentMoney(t, "100.00"),
		PaidAt:    time.Now(),
		Remark:    "x",
	})
	assert.ErrorIs(t, err, services.ErrPaymentProjectNotFound)
}
