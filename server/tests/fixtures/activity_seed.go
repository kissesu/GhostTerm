// @file activity_seed.go
// @description 进度时间线 7 类事件的统一 seeder + 通用测试上下文/项目/文件/用户 helper。
//
// 业务流程：
//   - NewTestDB：基于 testutil.StartPostgres 起 dockertest postgres 容器并跑迁移
//   - SeedAdminAuthContext：插一个 super_admin 用户，返回 services.AuthContext
//   - SeedNonMemberAuthContext：插一个 dev 用户但 *不* 加入任何 project_members
//   - SeedProject：插一个 project（caller 自动加入 project_members 当 owner）
//   - SeedFile：插一个 files 行（thesis_version / project_files 关联前置）
//   - SeedFeedback / SeedStatusChange / SeedQuoteChange / SeedPayment /
//     SeedThesisVersion / SeedProjectFile：7 张事件表的 1:1 seeder
//
// 设计取舍：
//   - 沿用 tests/integration 既有惯例：ad-hoc INSERT + RETURNING id，不引入 ORM
//   - 用户名 / 项目名等带 nanoTime 后缀避免同进程多 NewTestDB 撞 UNIQUE
//     （testutil 每测试自起容器，多数情况下其实不冲突，加保险不费事）
//
// @author Atlas.oi
// @date 2026-05-01

package fixtures

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"github.com/ghostterm/progress-server/internal/auth"
	"github.com/ghostterm/progress-server/internal/services"
	"github.com/ghostterm/progress-server/internal/testutil"
)

// uniqCounter 让同一进程内多次调用同一 helper 时拼出全局唯一 username/storage_path，
// 避免 UNIQUE 约束在并发或失败重跑场景下误报。
var uniqCounter atomic.Uint64

func nextUniq() uint64 {
	return uniqCounter.Add(1)
}

// ============================================================
// TestDB：dockertest 容器 + 连接池 + cleanup 包装
// ============================================================

// TestDB 包装 dockertest 启动的 postgres 容器和连接池。
//
// 业务背景：plan 里的服务测试以 fixtures.NewTestDB(t) 返回 tdb 后用 tdb.Pool；
// 沿用此约定，把 testutil.StartPostgres 的两个返回值打包进结构体即可。
type TestDB struct {
	Pool    *pgxpool.Pool
	cleanup func()
}

// Close 关闭连接池并销毁容器。defer tdb.Close() 即可。
func (t *TestDB) Close() {
	if t.cleanup != nil {
		t.cleanup()
	}
}

// NewTestDB 启动一个全新的 postgres 容器（已跑全部迁移）并返回 TestDB 包装。
func NewTestDB(t *testing.T) *TestDB {
	t.Helper()
	pool, cleanup := testutil.StartPostgres(t)
	return &TestDB{Pool: pool, cleanup: cleanup}
}

// ============================================================
// 用户 / 项目 / 文件 helper
// ============================================================

// SeedAdminAuthContext 插一个 super_admin 用户（role_id=1）并返回 AuthContext。
//
// 业务背景：admin 在 RLS 视角是"所有项目可见"，省掉手动 project_members 关联；
// 多数 service test 只关心"路径走通"，不关心 RLS 拒绝路径，admin 是默认选择。
func SeedAdminAuthContext(t *testing.T, ctx context.Context, pool *pgxpool.Pool) services.AuthContext {
	t.Helper()
	hash, err := auth.HashPassword("password", bcrypt.MinCost)
	require.NoError(t, err)

	uname := fmt.Sprintf("admin-fixture-%d", nextUniq())
	var id int64
	err = pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, display_name, role_id, is_active)
		VALUES ($1, $2, 'Fixture Admin', 1, TRUE)
		RETURNING id
	`, uname, hash).Scan(&id)
	require.NoError(t, err)

	return services.AuthContext{UserID: id, RoleID: 1}
}

// SeedNonMemberAuthContext 插一个 dev 用户（role_id=2）但 *不* 加入任何项目。
//
// 业务背景：用于 RLS 拒绝路径测试 —— 普通 dev 角色没有 is_admin() 加持，
// 不在 project_members 里就看不到对应项目，service.List 应返回 ErrActivityProjectNotFound。
func SeedNonMemberAuthContext(t *testing.T, ctx context.Context, pool *pgxpool.Pool) services.AuthContext {
	t.Helper()
	hash, err := auth.HashPassword("password", bcrypt.MinCost)
	require.NoError(t, err)

	uname := fmt.Sprintf("stranger-fixture-%d", nextUniq())
	var id int64
	err = pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, display_name, role_id, is_active)
		VALUES ($1, $2, 'Fixture Stranger', 2, TRUE)
		RETURNING id
	`, uname, hash).Scan(&id)
	require.NoError(t, err)

	return services.AuthContext{UserID: id, RoleID: 2}
}

// SeedProject 插一个项目 + 把 ownerUserID 当成 owner 加入 project_members。
//
// 业务背景：进度模块的 RLS 主要看 is_member(project_id)；测试需要"caller 是项目成员"
// 才能命中正向路径。把 owner 关联自动做掉，省掉每个测试重复 5 行 INSERT。
//
// customer_label 是 0003 后的必填字段；description / deadline 也都 NOT NULL，
// 这里给安全的默认值，测试不关心具体内容时直接调用即可。
func SeedProject(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ownerUserID int64) int64 {
	t.Helper()
	pname := fmt.Sprintf("FixtureProject-%d", nextUniq())
	var id int64
	err := pool.QueryRow(ctx, `
		INSERT INTO projects (name, customer_label, description, deadline, created_by, original_quote)
		VALUES ($1, 'FixtureCustomer', 'fixture description', NOW() + INTERVAL '30 days', $2, 1000.00)
		RETURNING id
	`, pname, ownerUserID).Scan(&id)
	require.NoError(t, err)

	// owner 自动加入 project_members（owner 角色），让 is_member(project_id) 通过
	_, err = pool.Exec(ctx, `
		INSERT INTO project_members (project_id, user_id, role)
		VALUES ($1, $2, 'owner')
	`, id, ownerUserID)
	require.NoError(t, err)
	return id
}

// SeedFile 插一个 files 行（uuid + storage_path 用 gen_random_uuid 防 UNIQUE 撞）。
//
// 业务背景：thesis_versions / project_files 都有 file_id FK，必须先有 files 行；
// 沿用 feedback_test.go 已验证的 storage_path 拼 uuid 模式。
func SeedFile(t *testing.T, ctx context.Context, pool *pgxpool.Pool, uploaderUserID int64, filename, mimeType string) int64 {
	t.Helper()
	var id int64
	err := pool.QueryRow(ctx, `
		INSERT INTO files (uuid, filename, mime_type, size_bytes, storage_path, uploaded_by)
		VALUES (gen_random_uuid(), $1, $2, 1024, '/tmp/fixture-' || gen_random_uuid()::TEXT, $3)
		RETURNING id
	`, filename, mimeType, uploaderUserID).Scan(&id)
	require.NoError(t, err)
	return id
}

// ============================================================
// 7 类事件 seeder（plan §Task 4 verbatim）
// ============================================================

// SeedFeedback 插入一条 feedback 并返回 id。
func SeedFeedback(t *testing.T, ctx context.Context, pool *pgxpool.Pool, projectID, userID int64, content string, recordedAt time.Time) int64 {
	t.Helper()
	var id int64
	err := pool.QueryRow(ctx, `
		INSERT INTO feedbacks (project_id, content, source, status, recorded_by, recorded_at)
		VALUES ($1, $2, 'wechat', 'pending', $3, $4)
		RETURNING id
	`, projectID, content, userID, recordedAt).Scan(&id)
	require.NoError(t, err)
	return id
}

// SeedStatusChange 插入一条状态变更日志。
func SeedStatusChange(t *testing.T, ctx context.Context, pool *pgxpool.Pool,
	projectID, userID int64, code, name, fromStatus, toStatus, remark string, triggeredAt time.Time) int64 {
	t.Helper()
	var id int64
	err := pool.QueryRow(ctx, `
		INSERT INTO status_change_logs
			(project_id, event_code, event_name, from_status, to_status, remark, triggered_by, triggered_at)
		VALUES ($1, $2, $3, $4::project_status, $5::project_status, $6, $7, $8)
		RETURNING id
	`, projectID, code, name, fromStatus, toStatus, remark, userID, triggeredAt).Scan(&id)
	require.NoError(t, err)
	return id
}

// SeedQuoteChange 插入一条报价变更日志。
func SeedQuoteChange(t *testing.T, ctx context.Context, pool *pgxpool.Pool,
	projectID, userID int64, changeType, delta, oldQuote, newQuote, reason, phase string, changedAt time.Time) int64 {
	t.Helper()
	var id int64
	err := pool.QueryRow(ctx, `
		INSERT INTO quote_change_logs
			(project_id, change_type, delta, old_quote, new_quote, reason, phase, changed_by, changed_at)
		VALUES ($1, $2::quote_change_type, $3::numeric, $4::numeric, $5::numeric, $6, $7::project_status, $8, $9)
		RETURNING id
	`, projectID, changeType, delta, oldQuote, newQuote, reason, phase, userID, changedAt).Scan(&id)
	require.NoError(t, err)
	return id
}

// SeedPayment 插入一条付款记录。
//
// direction = "customer_in" 时 relatedUserID/screenshotID 可为 0；
// direction = "dev_settlement" 时必须传非零值（CHECK 约束 chk_settlement_required_fields）。
func SeedPayment(t *testing.T, ctx context.Context, pool *pgxpool.Pool,
	projectID, userID int64, direction, amount, remark string, paidAt time.Time,
	relatedUserID, screenshotID int64) int64 {
	t.Helper()
	var related, screenshot any
	if relatedUserID > 0 {
		related = relatedUserID
	}
	if screenshotID > 0 {
		screenshot = screenshotID
	}
	var id int64
	err := pool.QueryRow(ctx, `
		INSERT INTO payments
			(project_id, direction, amount, paid_at, related_user_id, screenshot_id, remark, recorded_by, recorded_at)
		VALUES ($1, $2::payment_direction, $3::numeric, $4, $5, $6, $7, $8, NOW())
		RETURNING id
	`, projectID, direction, amount, paidAt, related, screenshot, remark, userID).Scan(&id)
	require.NoError(t, err)
	return id
}

// SeedThesisVersion 插入一条论文版本（需要先 SeedFile 拿到 fileID）。
func SeedThesisVersion(t *testing.T, ctx context.Context, pool *pgxpool.Pool,
	projectID, fileID, userID int64, versionNo int, remark string, uploadedAt time.Time) int64 {
	t.Helper()
	var id int64
	err := pool.QueryRow(ctx, `
		INSERT INTO thesis_versions
			(project_id, file_id, version_no, remark, uploaded_by, uploaded_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`, projectID, fileID, versionNo, remark, userID, uploadedAt).Scan(&id)
	require.NoError(t, err)
	return id
}

// SeedProjectFile 插入一条 project_file 关联（需要先 SeedFile 拿到 fileID）。
func SeedProjectFile(t *testing.T, ctx context.Context, pool *pgxpool.Pool,
	projectID, fileID, addedBy int64, category string, addedAt time.Time) int64 {
	t.Helper()
	var id int64
	err := pool.QueryRow(ctx, `
		INSERT INTO project_files (project_id, file_id, category, added_at, added_by)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id
	`, projectID, fileID, category, addedAt, addedBy).Scan(&id)
	require.NoError(t, err)
	return id
}
