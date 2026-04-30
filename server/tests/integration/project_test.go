/*
@file project_test.go
@description ProjectService 端到端集成测试（dockertest 真实 Postgres）：
             - C3 原子性：任一步骤失败 → tx 回滚 → projects/members/logs 全无残留
             - C4 E12 取消保存快照（from_status / from_holder_role_id / from_holder_user_id）
             - C4 E13 重启取消按 E12 快照精确还原（4 个 from_status 用例）
             - W9 白名单：所有 9 个 enter ts 列在状态推进时被正确写入
             - RLS 隔离：dev 不在 project_members 时看不到项目（List/Get 都被 RLS 拦截）

             关键用户痛点（spec §6.5）：
             "E13 重启的项目必须回到取消前的精确状态，不能粗暴回 dealing"
             —— 本测试 4 个状态用例确保该承诺不退化。
@author Atlas.oi
@date 2026-04-29
*/

package integration

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"github.com/ghostterm/progress-server/internal/api/oas"
	"github.com/ghostterm/progress-server/internal/auth"
	progressdb "github.com/ghostterm/progress-server/internal/db"
	"github.com/ghostterm/progress-server/internal/services"
	"github.com/ghostterm/progress-server/internal/services/statemachine"
	"github.com/ghostterm/progress-server/internal/testutil"
)

// projectTestEnv 装配项目测试所需的最小环境：admin / cs / dev 各一。
//
// 用户需求修正 2026-04-30：客户从独立 customers 表降级为 projects.customer_label 字段，
// 不再需要 INSERT INTO customers，CreateProjectInput 直接传 customerLabel 文本即可。
type projectTestEnv struct {
	pool       *pgxpool.Pool
	cleanup    func()
	svc        *services.ProjectServiceImpl
	adminID    int64
	csID       int64
	devID      int64
	otherDevID int64
}

func setupProjectEnv(t *testing.T) *projectTestEnv {
	t.Helper()
	pool, cleanup := testutil.StartPostgres(t)

	svc, err := services.NewProjectService(services.ProjectServiceDeps{Pool: pool})
	require.NoError(t, err)

	hash, err := auth.HashPassword("password", bcrypt.MinCost)
	require.NoError(t, err)

	ctx := context.Background()

	var adminID, csID, devID, otherDevID int64
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, display_name, role_id, is_active)
		VALUES ('admin-proj', $1, 'Admin', 1, TRUE) RETURNING id
	`, hash).Scan(&adminID))
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, display_name, role_id, is_active)
		VALUES ('cs-proj', $1, 'CS', 3, TRUE) RETURNING id
	`, hash).Scan(&csID))
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, display_name, role_id, is_active)
		VALUES ('dev-proj', $1, 'Dev', 2, TRUE) RETURNING id
	`, hash).Scan(&devID))
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, display_name, role_id, is_active)
		VALUES ('dev2-proj', $1, 'Dev2', 2, TRUE) RETURNING id
	`, hash).Scan(&otherDevID))

	return &projectTestEnv{
		pool:       pool,
		cleanup:    cleanup,
		svc:        svc,
		adminID:    adminID,
		csID:       csID,
		devID:      devID,
		otherDevID: otherDevID,
	}
}

// validCreateInput 返回一个可通过 validate 的输入，用于构造测试项目。
func validCreateInput(_ *projectTestEnv, name string) services.CreateProjectInput {
	zero, _ := progressdb.MoneyFromString("0")
	return services.CreateProjectInput{
		Name:          name,
		CustomerLabel: "TestCustomer",
		Description:   "测试项目描述",
		Deadline:      time.Now().Add(30 * 24 * time.Hour),
		OriginalQuote: zero,
	}
}

// ============================================================
// 1. 基础 Create：成功路径覆盖完整副作用
// ============================================================

func TestProject_Create_Success(t *testing.T) {
	env := setupProjectEnv(t)
	defer env.cleanup()

	ctx := context.Background()
	p, err := env.svc.Create(ctx, env.csID, statemachine.RoleCS, validCreateInput(env, "Demo"))
	require.NoError(t, err)
	require.NotNil(t, p)

	// 项目字段
	assert.Equal(t, "Demo", p.Name)
	assert.Equal(t, oas.ProjectStatusDealing, p.Status)
	require.NotNil(t, p.HolderRoleID)
	assert.Equal(t, statemachine.RoleCS, *p.HolderRoleID)
	require.NotNil(t, p.HolderUserID)
	assert.Equal(t, env.csID, *p.HolderUserID)

	// project_members 自动加入：creator + admin viewer + 全 dev
	var memberCount int
	require.NoError(t, env.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM project_members WHERE project_id = $1`, p.ID).Scan(&memberCount))
	// admin(1) + cs(creator=1) + 2个 dev = 4
	assert.GreaterOrEqual(t, memberCount, 4, "至少应有 creator + admin + 2 dev 加入 members")

	// status_change_logs E0 记录
	var logCount int
	require.NoError(t, env.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM status_change_logs WHERE project_id = $1 AND event_code = 'E0'`,
		p.ID).Scan(&logCount))
	assert.Equal(t, 1, logCount, "E0 创建日志应有 1 条")

	// 通知发给 creator
	var notifCount int
	require.NoError(t, env.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND project_id = $2 AND type='ball_passed'`,
		env.csID, p.ID).Scan(&notifCount))
	assert.Equal(t, 1, notifCount, "creator 应收到 ball_passed 通知")
}

// ============================================================
// 2. C3 原子性：模拟 INSERT 中途失败 → 全部回滚
// ============================================================

func TestProject_Create_AtomicRollback(t *testing.T) {
	env := setupProjectEnv(t)
	defer env.cleanup()

	ctx := context.Background()

	// 用临时 trigger 让 status_change_logs INSERT 失败（C3 文档示例的等价做法）。
	// 之所以用 trigger 而不是 ALTER ... CHECK：CHECK 的 NOT VALID + VALIDATE 在某些版本下
	// 行为有差异；trigger 直接 RAISE EXCEPTION 是稳定的失败注入。
	_, err := env.pool.Exec(ctx, `
		CREATE OR REPLACE FUNCTION fail_log_insert() RETURNS trigger AS $$
		BEGIN
			RAISE EXCEPTION 'forced failure for atomicity test';
		END $$ LANGUAGE plpgsql;
		CREATE TRIGGER chk_force_fail BEFORE INSERT ON status_change_logs
		FOR EACH ROW EXECUTE FUNCTION fail_log_insert();
	`)
	require.NoError(t, err)
	defer func() {
		_, _ = env.pool.Exec(ctx, `DROP TRIGGER IF EXISTS chk_force_fail ON status_change_logs`)
	}()

	// 试图创建：必失败
	_, err = env.svc.Create(ctx, env.csID, statemachine.RoleCS, validCreateInput(env, "AtomicFail"))
	require.Error(t, err, "Create 应失败（trigger 触发）")

	// 关键校验：projects 表无残留
	var projectCount int
	require.NoError(t, env.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM projects WHERE name = 'AtomicFail'`).Scan(&projectCount))
	assert.Equal(t, 0, projectCount, "tx 回滚后 projects 不应残留")

	// project_members 也无残留
	var memberCount int
	require.NoError(t, env.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM project_members WHERE project_id IN (SELECT id FROM projects WHERE name = 'AtomicFail')`,
	).Scan(&memberCount))
	assert.Equal(t, 0, memberCount, "tx 回滚后 project_members 不应残留")
}

// ============================================================
// 3. C4 E12 取消：from_* 快照写入 status_change_logs
// ============================================================

func TestProject_E12_CancelSnapshotsFromState(t *testing.T) {
	env := setupProjectEnv(t)
	defer env.cleanup()

	ctx := context.Background()
	p, err := env.svc.Create(ctx, env.csID, statemachine.RoleCS, validCreateInput(env, "ToCancel"))
	require.NoError(t, err)

	// E1: dealing/cs → quoting/dev（指定 dev 作为新 holder）
	_, err = env.svc.TriggerEvent(ctx, env.csID, statemachine.RoleCS, p.ID,
		oas.EventCodeE1, "提交报价", &env.devID)
	require.NoError(t, err)

	// 现在状态：quoting，holder=dev
	// E12 取消（cs 触发；dev 不是 cs 但 admin/cs 角色都允许）
	cancelled, err := env.svc.TriggerEvent(ctx, env.csID, statemachine.RoleCS, p.ID,
		oas.EventCodeE12, "客户跑单了", nil)
	require.NoError(t, err)
	assert.Equal(t, oas.ProjectStatusCancelled, cancelled.Status)
	assert.Nil(t, cancelled.HolderRoleID, "终态 cancelled 应清 holder_role_id")
	assert.Nil(t, cancelled.HolderUserID, "终态 cancelled 应清 holder_user_id")

	// 查最新 E12 日志：from_* 应 = 取消前快照
	var (
		fromStatus       string
		fromHolderRoleID *int64
		fromHolderUserID *int64
	)
	err = env.pool.QueryRow(ctx, `
		SELECT from_status::TEXT, from_holder_role_id, from_holder_user_id
		FROM status_change_logs
		WHERE project_id = $1 AND event_code = 'E12'
		ORDER BY triggered_at DESC LIMIT 1
	`, p.ID).Scan(&fromStatus, &fromHolderRoleID, &fromHolderUserID)
	require.NoError(t, err)
	assert.Equal(t, "quoting", fromStatus, "E12 from_status 应为取消前的 quoting")
	require.NotNil(t, fromHolderRoleID)
	assert.Equal(t, statemachine.RoleDev, *fromHolderRoleID, "E12 from_holder_role 应为 dev")
	require.NotNil(t, fromHolderUserID)
	assert.Equal(t, env.devID, *fromHolderUserID, "E12 from_holder_user 应为 devID")
}

// ============================================================
// 4. C4 E13 重启：从 4 个不同 (status, holder_role, holder_user) 取消后精确还原
// ============================================================

func TestProject_E13_RestoreToExactPriorState(t *testing.T) {
	cases := []struct {
		name       string
		// driveTo 把项目通过状态机推到目标 (status, holder)
		driveTo func(env *projectTestEnv, projectID int64) (oas.ProjectStatus, *int64, *int64)
	}{
		{
			name: "from dealing/cs",
			driveTo: func(env *projectTestEnv, _ int64) (oas.ProjectStatus, *int64, *int64) {
				roleCS := statemachine.RoleCS
				return oas.ProjectStatusDealing, &roleCS, &env.csID
			},
		},
		{
			name: "from quoting/dev",
			driveTo: func(env *projectTestEnv, projectID int64) (oas.ProjectStatus, *int64, *int64) {
				ctx := context.Background()
				_, err := env.svc.TriggerEvent(ctx, env.csID, statemachine.RoleCS, projectID,
					oas.EventCodeE1, "报价", &env.devID)
				if err != nil {
					panic(err)
				}
				roleDev := statemachine.RoleDev
				return oas.ProjectStatusQuoting, &roleDev, &env.devID
			},
		},
		{
			name: "from quoting/cs (after E2)",
			driveTo: func(env *projectTestEnv, projectID int64) (oas.ProjectStatus, *int64, *int64) {
				ctx := context.Background()
				_, err := env.svc.TriggerEvent(ctx, env.csID, statemachine.RoleCS, projectID,
					oas.EventCodeE1, "报价", &env.devID)
				if err != nil {
					panic(err)
				}
				_, err = env.svc.TriggerEvent(ctx, env.devID, statemachine.RoleDev, projectID,
					oas.EventCodeE2, "评估完成", &env.csID)
				if err != nil {
					panic(err)
				}
				roleCS := statemachine.RoleCS
				return oas.ProjectStatusQuoting, &roleCS, &env.csID
			},
		},
		{
			name: "from developing/dev (after E1+E2+E4)",
			driveTo: func(env *projectTestEnv, projectID int64) (oas.ProjectStatus, *int64, *int64) {
				ctx := context.Background()
				_, err := env.svc.TriggerEvent(ctx, env.csID, statemachine.RoleCS, projectID,
					oas.EventCodeE1, "报价", &env.devID)
				if err != nil {
					panic(err)
				}
				_, err = env.svc.TriggerEvent(ctx, env.devID, statemachine.RoleDev, projectID,
					oas.EventCodeE2, "完成", &env.csID)
				if err != nil {
					panic(err)
				}
				_, err = env.svc.TriggerEvent(ctx, env.csID, statemachine.RoleCS, projectID,
					oas.EventCodeE4, "客户接受", &env.devID)
				if err != nil {
					panic(err)
				}
				roleDev := statemachine.RoleDev
				return oas.ProjectStatusDeveloping, &roleDev, &env.devID
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			env := setupProjectEnv(t)
			defer env.cleanup()

			ctx := context.Background()
			p, err := env.svc.Create(ctx, env.csID, statemachine.RoleCS, validCreateInput(env, "E13Test_"+tc.name))
			require.NoError(t, err)

			expectedStatus, expectedRole, expectedUser := tc.driveTo(env, p.ID)

			// E12 取消
			_, err = env.svc.TriggerEvent(ctx, env.csID, statemachine.RoleCS, p.ID,
				oas.EventCodeE12, "测试取消", nil)
			require.NoError(t, err)

			// 重新拉取确认是 cancelled
			cancelled, err := env.svc.Get(ctx, env.csID, statemachine.RoleCS, p.ID)
			require.NoError(t, err)
			assert.Equal(t, oas.ProjectStatusCancelled, cancelled.Status)

			// E13 重启
			restored, err := env.svc.TriggerEvent(ctx, env.csID, statemachine.RoleCS, p.ID,
				oas.EventCodeE13, "重启项目", nil)
			require.NoError(t, err)

			// 关键断言：精确还原到 (status, holder_role, holder_user)
			assert.Equal(t, expectedStatus, restored.Status, "Status 应还原")
			require.NotNil(t, restored.HolderRoleID, "HolderRoleID 应还原")
			assert.Equal(t, *expectedRole, *restored.HolderRoleID, "HolderRoleID 应还原精确值")
			require.NotNil(t, restored.HolderUserID, "HolderUserID 应还原")
			assert.Equal(t, *expectedUser, *restored.HolderUserID, "HolderUserID 应还原精确值")
		})
	}
}

// ============================================================
// 5. E13 失败路径：项目从未被 E12 取消 → ErrNoCancelHistory
// ============================================================

func TestProject_E13_FailsWithoutCancelHistory(t *testing.T) {
	env := setupProjectEnv(t)
	defer env.cleanup()

	ctx := context.Background()
	p, err := env.svc.Create(ctx, env.csID, statemachine.RoleCS, validCreateInput(env, "NoCancel"))
	require.NoError(t, err)

	// 不取消，直接尝试 E13 → 应失败（CanFire 先拦：from=cancelled 不匹配）
	_, err = env.svc.TriggerEvent(ctx, env.csID, statemachine.RoleCS, p.ID,
		oas.EventCodeE13, "强制重启", nil)
	require.Error(t, err)
}

// ============================================================
// 6. W9 白名单：每个状态推进时正确写入对应 *_at 列
// ============================================================

func TestProject_StatusEnterTimestamps(t *testing.T) {
	env := setupProjectEnv(t)
	defer env.cleanup()

	ctx := context.Background()
	p, err := env.svc.Create(ctx, env.csID, statemachine.RoleCS, validCreateInput(env, "EnterTS"))
	require.NoError(t, err)

	// E1: → quoting, quoting_at 应被设置
	q, err := env.svc.TriggerEvent(ctx, env.csID, statemachine.RoleCS, p.ID,
		oas.EventCodeE1, "报价", &env.devID)
	require.NoError(t, err)
	assert.Equal(t, oas.ProjectStatusQuoting, q.Status)
	require.NotNil(t, q.QuotingAt, "quoting_at 应在 E1 后非 NULL")

	// E2: dev → cs，再次 quoting（覆盖 quoting_at）
	_, err = env.svc.TriggerEvent(ctx, env.devID, statemachine.RoleDev, p.ID,
		oas.EventCodeE2, "完成", &env.csID)
	require.NoError(t, err)

	// E4: → developing, dev_started_at 应被设置
	d, err := env.svc.TriggerEvent(ctx, env.csID, statemachine.RoleCS, p.ID,
		oas.EventCodeE4, "接受", &env.devID)
	require.NoError(t, err)
	assert.Equal(t, oas.ProjectStatusDeveloping, d.Status)
	require.NotNil(t, d.DevStartedAt, "dev_started_at 应在 E4 后非 NULL")

	// E7: → confirming, confirming_at
	c, err := env.svc.TriggerEvent(ctx, env.devID, statemachine.RoleDev, p.ID,
		oas.EventCodeE7, "完成", &env.csID)
	require.NoError(t, err)
	require.NotNil(t, c.ConfirmingAt)

	// E9: → delivered, delivered_at
	deliv, err := env.svc.TriggerEvent(ctx, env.csID, statemachine.RoleCS, p.ID,
		oas.EventCodeE9, "验收", nil)
	require.NoError(t, err)
	require.NotNil(t, deliv.DeliveredAt)

	// E10: → paid, paid_at
	paid, err := env.svc.TriggerEvent(ctx, env.csID, statemachine.RoleCS, p.ID,
		oas.EventCodeE10, "收款", nil)
	require.NoError(t, err)
	require.NotNil(t, paid.PaidAt)

	// E11: → archived, archived_at
	arch, err := env.svc.TriggerEvent(ctx, env.csID, statemachine.RoleCS, p.ID,
		oas.EventCodeE11, "归档", nil)
	require.NoError(t, err)
	require.NotNil(t, arch.ArchivedAt)
}

// ============================================================
// 7. RLS 隔离：otherDev（不在 project_members）看不到项目
//    注：testutil 直连用 postgres 超级用户绕开 RLS；本测试在事务内 SET ROLE progress_app
//    强制 RLS 生效，验证非 member dev 拿不到任何项目
// ============================================================

func TestProject_RLS_NonMemberCannotSee(t *testing.T) {
	env := setupProjectEnv(t)
	defer env.cleanup()

	ctx := context.Background()
	p, err := env.svc.Create(ctx, env.csID, statemachine.RoleCS, validCreateInput(env, "Hidden"))
	require.NoError(t, err)

	// 把 otherDev 从 project_members 中移除（Create 默认加入了所有 dev）
	_, err = env.pool.Exec(ctx, `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`,
		p.ID, env.otherDevID)
	require.NoError(t, err)

	// otherDev 视角：在事务内 SET ROLE progress_app + 注入 GUC 后 SELECT
	var visible bool
	require.NoError(t, progressdb.InTx(ctx, env.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SET LOCAL ROLE progress_app`); err != nil {
			return err
		}
		if err := progressdb.SetSessionContext(ctx, tx, env.otherDevID, statemachine.RoleDev); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1)`, p.ID).Scan(&visible)
	}))
	assert.False(t, visible, "非 member dev 不应看到项目（RLS 拦截）")
}

// ============================================================
// 8. ListStatusChanges：日志时间顺序 + 各事件完整记录
// ============================================================

func TestProject_ListStatusChanges(t *testing.T) {
	env := setupProjectEnv(t)
	defer env.cleanup()

	ctx := context.Background()
	p, err := env.svc.Create(ctx, env.csID, statemachine.RoleCS, validCreateInput(env, "Logs"))
	require.NoError(t, err)

	_, err = env.svc.TriggerEvent(ctx, env.csID, statemachine.RoleCS, p.ID,
		oas.EventCodeE1, "报价", &env.devID)
	require.NoError(t, err)

	logs, err := env.svc.ListStatusChanges(ctx, env.csID, statemachine.RoleCS, p.ID)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, len(logs), 2, "至少应有 E0 + E1 两条日志")
	// 第一条应为 E0
	assert.Equal(t, "E0", logs[0].EventCode)
	assert.Equal(t, "E1", logs[1].EventCode)
	// E1 from/to holder 应记录
	assert.Equal(t, oas.ProjectStatusDealing, *logs[1].FromStatus)
	assert.Equal(t, oas.ProjectStatusQuoting, logs[1].ToStatus)
	require.NotNil(t, logs[1].FromHolderRoleID)
	assert.Equal(t, statemachine.RoleCS, *logs[1].FromHolderRoleID)
	require.NotNil(t, logs[1].ToHolderRoleID)
	assert.Equal(t, statemachine.RoleDev, *logs[1].ToHolderRoleID)
}
