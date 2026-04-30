/*
@file tx.go
@description 事务 helper —— 把 BEGIN/COMMIT/ROLLBACK 模板化，业务代码只关心 fn 内的 SQL。
             panic 也会触发 rollback（避免连接卡在事务中泄漏到池）。
@author Atlas.oi
@date 2026-04-29
*/

package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// InTx 在一个事务中执行 fn。
//
// 业务流程：
//  1. 从 pool 申请连接并 BEGIN（默认隔离级别 = ReadCommitted，与 Postgres 默认一致）
//  2. 调 fn(tx)；若 fn panic，先 rollback 再向上 repanic（保证连接归还池）
//  3. fn 返回 error，rollback 后回传原 error
//  4. fn 成功，commit；commit 失败也回传 error
//
// 设计取舍：
//   - 不暴露 TxOptions —— Phase 1 没有需要 Serializable/ReadOnly 的场景，等真正需要时再扩展
//   - rollback 的错误丢弃（仅日志意义不大），保留首要 error
func InTx(ctx context.Context, pool *pgxpool.Pool, fn func(tx pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}

	// panic-safe rollback：fn 内部 panic 时不能让连接停留在事务中
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback(ctx)
			panic(p)
		}
	}()

	if err := fn(tx); err != nil {
		_ = tx.Rollback(ctx)
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}
