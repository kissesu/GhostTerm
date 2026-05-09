/**
 * @file event_targets.go
 * @description 算事件目标 user_ids 的 SQL helpers（spec v3.5 §6 5 处 service 共用）。
 *              避免每个 service 重复同 SQL；保持 DRY。
 *              project_service / feedback_service / payment_service 使用 queryProjectTargetUsers；
 *              permissions_service 使用 queryRoleUserIDs。
 * @author Atlas.oi
 * @date 2026-05-09
 */

package services

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// queryProjectTargetUsers 算"该项目相关的目标 user_ids":
//   - 全部活跃 admin role 用户（role_id=1）
//   - 该项目的 project_members 全员
//
// 用于 project.created / project.updated / feedback.created / payment.created 事件路由。
// 用 raw pool 查询不带 RLS GUC；admin + 项目成员都在白名单内；UNION 去重。
func queryProjectTargetUsers(ctx context.Context, pool *pgxpool.Pool, projectID int64) ([]int64, error) {
	rows, err := pool.Query(ctx, `
		SELECT u.id FROM users u WHERE u.is_active AND u.role_id = 1
		UNION
		SELECT pm.user_id FROM project_members pm WHERE pm.project_id = $1
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var uid int64
		if err := rows.Scan(&uid); err != nil {
			return nil, err
		}
		out = append(out, uid)
	}
	return out, rows.Err()
}

// queryRoleUserIDs 算"该 role_id 下所有活跃 user_ids":
// 用于 role_permissions.updated 事件路由（让该 role 全部用户立即重拉 effective-permissions）。
func queryRoleUserIDs(ctx context.Context, pool *pgxpool.Pool, roleID int64) ([]int64, error) {
	rows, err := pool.Query(ctx, `SELECT id FROM users WHERE role_id = $1 AND is_active`, roleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var uid int64
		if err := rows.Scan(&uid); err != nil {
			return nil, err
		}
		out = append(out, uid)
	}
	return out, rows.Err()
}
