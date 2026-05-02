/*
@file migrations_test.go
@description 迁移产物结构性校验 —— 跑完 0001..0007 后应有 10 个用户自定义函数：
             - 4 个 RLS 辅助（current_user_id / current_role_id / is_admin / is_member）
             - 3 个 SECURITY DEFINER（insert_notification_secure / consume_ws_ticket / rotate_refresh_token）
             - 3 个 0007 trigger 函数（reject_super_admin_user_permissions /
               reject_super_admin_role_permissions / reject_promote_user_with_overrides）
             也顺带验证 3 条 system role（admin/manager/staff）已 INSERT。
@author Atlas.oi
@date 2026-04-29
*/

package integration

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ghostterm/progress-server/internal/testutil"
)

func TestMigrations_FunctionsCount(t *testing.T) {
	pool, cleanup := testutil.StartPostgres(t)
	defer cleanup()

	ctx := context.Background()

	// 业务背景：information_schema.routines 的 routine_schema = 'public' 过滤掉
	// pg_catalog 内置函数；routine_type='FUNCTION' 排除 PROCEDURE（本项目暂不用 procedure）
	var count int
	err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM information_schema.routines
		WHERE routine_schema = 'public' AND routine_type = 'FUNCTION'
	`).Scan(&count)
	require.NoError(t, err)
	assert.Equal(t, 10, count,
		"应有 4 个 RLS 辅助 + 3 个 SECURITY DEFINER + 3 个 0007 super_admin trigger 函数")
}

func TestMigrations_SystemRolesSeeded(t *testing.T) {
	pool, cleanup := testutil.StartPostgres(t)
	defer cleanup()

	ctx := context.Background()
	var count int
	err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM roles WHERE is_system = TRUE`).Scan(&count)
	require.NoError(t, err)
	assert.Equal(t, 3, count, "spec §3.4: admin/manager/staff 三个系统角色")
}

func TestMigrations_RLSEnabledOnCoreTables(t *testing.T) {
	pool, cleanup := testutil.StartPostgres(t)
	defer cleanup()

	ctx := context.Background()
	// 0002_rls 应在核心业务表上启用 RLS；这里抽样 projects / project_members / feedbacks
	// 用户需求修正 2026-04-30：customers 表已被 0003 migration drop（客户降级为 customer_label 字段）
	rows, err := pool.Query(ctx, `
		SELECT relname FROM pg_class
		WHERE relrowsecurity = TRUE
		  AND relname IN ('projects', 'project_members', 'feedbacks')
		ORDER BY relname
	`)
	require.NoError(t, err)
	defer rows.Close()

	var names []string
	for rows.Next() {
		var n string
		require.NoError(t, rows.Scan(&n))
		names = append(names, n)
	}
	require.NoError(t, rows.Err())
	assert.ElementsMatch(t, []string{"projects", "project_members", "feedbacks"}, names)
}
