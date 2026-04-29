/*
@file guc.go
@description RLS GUC（GRand Unified Configuration）注入 helper：在事务内 SET LOCAL
             app.user_id 与 app.role_id，让 0002 migration 中的 current_user_id() /
             current_role_id() / is_admin() / is_member() helper 能读到当前会话身份。

             业务背景（v2 part2 §W11+）：
             - pgxpool 每条 query 可能拿不同连接；连接级 SET LOCAL 不可靠（连接归还池后会话变量
               跟随连接漂走，下一个借走它的请求就拿到了别人的身份）
             - 唯一可靠的注入路径 = 事务内 SET LOCAL —— 第三参数 true 表示"仅本事务可见"，
               commit/rollback 自动失效，连接归还池时是干净的
             - 因此所有需要 RLS 生效的查询必须先 BEGIN 再 SetSessionContext 再业务 SQL，
               不能在普通 pool.Query 路径上跑

             调用约定：
             - service 层在 InTx(...) 内第一行调 SetSessionContext，后续业务 SQL 自动受 RLS 约束
             - 不在中间件做：中间件级别 SET 会泄漏到下一请求（同上）
@author Atlas.oi
@date 2026-04-29
*/

package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// SetSessionContext 在事务 tx 内注入 RLS 会话变量。
//
// 业务流程：
//  1. 校验 tx 非 nil（防御编程：caller 误传 nil 时立刻 fail-fast）
//  2. SELECT set_config('app.user_id',  $1::TEXT, true)
//     SELECT set_config('app.role_id',  $2::TEXT, true)
//     —— 第三参数 true = is_local，仅本事务可见，commit/rollback 自动失效
//  3. 用单条 SELECT 把两个 set_config 一次发起，省一次 round-trip
//
// 设计取舍：
//   - 用 set_config(...) 而不是 SET LOCAL：set_config 是函数调用，能用 $1 参数
//     而 SET LOCAL app.user_id = $1 不能（PG 不支持参数化 SET）；前者天然防 SQL 注入
//   - userID/roleID 转 string 再入库：app.user_id 是 TEXT GUC，
//     0002 migration 的 helper 会 NULLIF + ::BIGINT，0 / 空串都映射为 NULL（拒绝默认）
//   - 不接收 *services.AuthContext：services 包反过来 import db 时会循环依赖；
//     传两个 int64 让 db 包零依赖
func SetSessionContext(ctx context.Context, tx pgx.Tx, userID, roleID int64) error {
	if tx == nil {
		return fmt.Errorf("db: SetSessionContext requires non-nil tx")
	}
	// 单条 SELECT 同时设两个变量，节省一次 round-trip
	_, err := tx.Exec(ctx,
		`SELECT set_config('app.user_id', $1::TEXT, true), set_config('app.role_id', $2::TEXT, true)`,
		fmt.Sprintf("%d", userID),
		fmt.Sprintf("%d", roleID),
	)
	if err != nil {
		return fmt.Errorf("db: set RLS session context: %w", err)
	}
	return nil
}
