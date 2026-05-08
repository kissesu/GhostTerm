// @file audit_service_test.go
// @description AuditService 测试 —— 覆盖 finding #20 的 5 个核心场景：
//
//	1. LogLoginSuccess：基础写入 + user_id / metadata / 11 类事件枚举之一
//	2. LogLoginFailedNoUserID：UserID nil（失败登录不知道是谁）
//	3. RuleBlocksUpdate：UPDATE 被 RULE INSTEAD NOTHING 拦（应用账户被攻陷防篡改）
//	4. RuleBlocksDelete：DELETE 同上
//	5. NilMetadataDefaults：Metadata nil 不报错 + DB 存 '{}' 默认值
//	6. NilServiceShortCircuit：nil receiver 短路返 nil，让测试 fixture 免注入
//
// @author Atlas.oi
// @date 2026-05-08

package services_test

import (
	"bytes"
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/ghostterm/progress-server/internal/services"
	"github.com/ghostterm/progress-server/internal/testutil"
)

func TestAuditService_LogLoginSuccess(t *testing.T) {
	pool, cleanup := testutil.StartPostgres(t)
	defer cleanup()
	ctx := context.Background()

	svc, err := services.NewAuditService(pool)
	require.NoError(t, err)

	userID := int64(1) // 0001 migration 预置 admin
	require.NoError(t, svc.Log(ctx, services.AuditEvent{
		EventType: services.AuditEventLoginSuccess,
		UserID:    &userID,
		ClientIP:  "1.2.3.4",
		UserAgent: "test-agent/1.0",
		Metadata:  map[string]any{"role_id": 1},
	}))

	var count int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM security_audit_log WHERE event_type='login_success' AND user_id=$1`,
		userID).Scan(&count))
	require.Equal(t, 1, count)
}

func TestAuditService_LogLoginFailedNoUserID(t *testing.T) {
	pool, cleanup := testutil.StartPostgres(t)
	defer cleanup()
	ctx := context.Background()

	svc, err := services.NewAuditService(pool)
	require.NoError(t, err)

	// 失败登录：尝试用未知用户名时 UserID 不可知（防 user enumeration）
	require.NoError(t, svc.Log(ctx, services.AuditEvent{
		EventType: services.AuditEventLoginFailed,
		UserID:    nil,
		ClientIP:  "9.9.9.9",
		UserAgent: "evil-scanner/1.0",
		Metadata:  map[string]any{"username_attempted": "admin"},
	}))

	var count int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM security_audit_log WHERE event_type='login_failed' AND user_id IS NULL`).Scan(&count))
	require.Equal(t, 1, count)
}

func TestAuditService_TriggerBlocksAppUpdate(t *testing.T) {
	pool, cleanup := testutil.StartPostgres(t)
	defer cleanup()
	ctx := context.Background()

	svc, err := services.NewAuditService(pool)
	require.NoError(t, err)
	require.NoError(t, svc.Log(ctx, services.AuditEvent{EventType: services.AuditEventLogoutSuccess}))

	// trigger 区分 session_user：dockertest 默认 postgres 角色放行（FK 级联场景需要），
	// 模拟生产场景 progress_app 主动 UPDATE → trigger RAISE 拒绝
	conn, err := pool.Acquire(ctx)
	require.NoError(t, err)
	defer conn.Release()

	_, err = conn.Exec(ctx, `SET SESSION AUTHORIZATION progress_app`)
	require.NoError(t, err)
	_, err = conn.Exec(ctx, `UPDATE security_audit_log SET event_type='login_success'`)
	require.Error(t, err, "progress_app 主动 UPDATE 应被 GRANT/trigger 双层拒绝")
	// GRANT 是第一道（permission denied），trigger 是第二道（绕权后 RAISE append-only）；
	// 任一命中都满足 finding #20 要求
	errMsg := err.Error()
	require.True(t,
		bytes.Contains([]byte(errMsg), []byte("permission denied")) ||
			bytes.Contains([]byte(errMsg), []byte("append-only")),
		"错误应来自 GRANT 拒绝或 trigger RAISE，实际：%s", errMsg)

	// 重置 session 后验证原始事件未被改写
	_, _ = conn.Exec(ctx, `RESET SESSION AUTHORIZATION`)
	var et string
	require.NoError(t, conn.QueryRow(ctx, `SELECT event_type FROM security_audit_log LIMIT 1`).Scan(&et))
	require.Equal(t, string(services.AuditEventLogoutSuccess), et)
}

func TestAuditService_TriggerBlocksAppDelete(t *testing.T) {
	pool, cleanup := testutil.StartPostgres(t)
	defer cleanup()
	ctx := context.Background()

	svc, err := services.NewAuditService(pool)
	require.NoError(t, err)
	require.NoError(t, svc.Log(ctx, services.AuditEvent{EventType: services.AuditEventLogoutSuccess}))

	conn, err := pool.Acquire(ctx)
	require.NoError(t, err)
	defer conn.Release()

	_, err = conn.Exec(ctx, `SET SESSION AUTHORIZATION progress_app`)
	require.NoError(t, err)
	_, err = conn.Exec(ctx, `DELETE FROM security_audit_log`)
	require.Error(t, err, "progress_app 主动 DELETE 应被 GRANT/trigger 双层拒绝")
	errMsg := err.Error()
	require.True(t,
		bytes.Contains([]byte(errMsg), []byte("permission denied")) ||
			bytes.Contains([]byte(errMsg), []byte("append-only")),
		"错误应来自 GRANT 拒绝或 trigger RAISE，实际：%s", errMsg)

	_, _ = conn.Exec(ctx, `RESET SESSION AUTHORIZATION`)
	var count int
	require.NoError(t, conn.QueryRow(ctx, `SELECT count(*) FROM security_audit_log`).Scan(&count))
	require.Equal(t, 1, count, "DELETE 应被双层拒绝，原数据保留")
}

func TestAuditService_AllowsFKCascadeFromSuperuser(t *testing.T) {
	// FK ON DELETE SET NULL 在 user 行被删时触发 audit.user_id = NULL；
	// 这条路径是 PG 内部级联（执行权限走 table owner = postgres superuser）
	// 必须不被 trigger 拦，否则 DELETE users 整个断流
	pool, cleanup := testutil.StartPostgres(t)
	defer cleanup()
	ctx := context.Background()

	// 建一个临时 dev 用户 + 写一条 audit 引用它
	var devID int64
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, display_name, role_id)
		VALUES ('audit-fk-test', 'x', 'Audit FK Test', 2) RETURNING id
	`).Scan(&devID))

	svc, err := services.NewAuditService(pool)
	require.NoError(t, err)
	require.NoError(t, svc.Log(ctx, services.AuditEvent{
		EventType: services.AuditEventLoginSuccess,
		UserID:    &devID,
	}))

	// 删除 user 应触发 FK ON DELETE SET NULL，audit 行 user_id 被置 NULL，trigger 必须放行
	_, err = pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, devID)
	require.NoError(t, err, "FK ON DELETE SET NULL 不应被 trigger 拦截")

	// 验证 audit 行仍存在但 user_id 已置 NULL
	var nullCount int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM security_audit_log WHERE user_id IS NULL AND event_type='login_success'`).Scan(&nullCount))
	require.Equal(t, 1, nullCount)
}

func TestAuditService_NilMetadataDefaults(t *testing.T) {
	pool, cleanup := testutil.StartPostgres(t)
	defer cleanup()
	ctx := context.Background()

	svc, err := services.NewAuditService(pool)
	require.NoError(t, err)

	// Metadata nil → service 内部转 '{}'；DB 列 NOT NULL DEFAULT '{}'::jsonb 兜底
	require.NoError(t, svc.Log(ctx, services.AuditEvent{
		EventType: services.AuditEventLogoutSuccess,
		Metadata:  nil,
	}))

	var metadataStr string
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT metadata::TEXT FROM security_audit_log LIMIT 1`).Scan(&metadataStr))
	require.Equal(t, "{}", metadataStr)
}

func TestAuditService_NilServiceShortCircuit(t *testing.T) {
	// nil receiver 不 panic：测试 fixture 不注入 audit service 也不阻断业务
	var svc *services.AuditService
	require.NoError(t, svc.Log(context.Background(), services.AuditEvent{
		EventType: services.AuditEventLoginSuccess,
	}))
}

// TestAuditService_LogSurvivesCallerCtxCancel 验证：
// caller ctx 已被 cancel 仍能完成审计写入（C4 ctx 解耦防静默丢失）。
//
// 攻击场景（C4）：登录路径 attacker 在 bcrypt 完成时把 TCP 拖到
// HTTP timeout 触发 ctx.Cancel → 原实现 audit.Log 立即返 ctx.Err() 失败
// 没机会写入 → LoginFailed 审计静默丢失 → 多次撞库不留 trace。
//
// 修复：audit_service.Log 内 context.WithoutCancel + 5s timeout 解耦
// caller ctx，写入独立完成。
func TestAuditService_LogSurvivesCallerCtxCancel(t *testing.T) {
	pool, cleanup := testutil.StartPostgres(t)
	defer cleanup()

	svc, err := services.NewAuditService(pool)
	require.NoError(t, err)

	// caller ctx 立即 cancel —— 模拟 client 断连后的内部 goroutine
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	require.Error(t, ctx.Err(), "ctx 必须已 cancel 才能验证解耦行为")

	// 即便 caller ctx 已死，审计写入仍必须成功
	userID := int64(1)
	require.NoError(t, svc.Log(ctx, services.AuditEvent{
		EventType: services.AuditEventLoginFailed,
		UserID:    &userID,
		ClientIP:  "9.9.9.9",
		UserAgent: "ctx-cancel-test",
		Metadata:  map[string]any{"reason": "ctx_cancel_regression"},
	}), "caller ctx 已 cancel 时 audit.Log 必须仍能完成（C4 解耦）")

	// 验证记录已落库
	var count int
	require.NoError(t, pool.QueryRow(context.Background(),
		`SELECT count(*) FROM security_audit_log
		 WHERE event_type='login_failed' AND user_agent='ctx-cancel-test'`).Scan(&count))
	require.Equal(t, 1, count, "审计记录必须已写入 DB")
}

func TestAuditService_RejectsNilPool(t *testing.T) {
	_, err := services.NewAuditService(nil)
	require.Error(t, err)
}
