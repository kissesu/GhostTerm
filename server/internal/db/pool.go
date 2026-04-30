/*
@file pool.go
@description pgx 连接池构造器，按 v2 part5 §NC5-fix 在 AfterConnect 显式注册
             NUMERIC OID(1700) → text codec，避免 pgx 默认 pgtype.Numeric 路径与 db.Money（string 编解码）
             不一致导致的 scan 失败。NUMERIC 列因此全程走 string，与 OpenAPI 中 Money pattern("123.45")
             一致，前后端类型契约对齐。
@author Atlas.oi
@date 2026-04-29
*/

package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewPool 创建一个连接池，并在每个新连接初始化时把 NUMERIC OID 切换到 text codec。
//
// 业务背景（v2 part5 §NC5-fix）：
//  1. pgx v5 默认把 NUMERIC 列 scan 成 pgtype.Numeric（含 Int + Exp），但本项目的 Money 类型
//     直接走 string（与 NUMERIC(12,2) 字面表示一致，前后端 JSON 也是 "123.45"），两者不兼容。
//  2. 通过 AfterConnect 把 OID=1700 的 codec 替换为 TextOID 的 codec，让所有 NUMERIC scan/exec
//     都走 string —— 这与 db.Money.Value/Scan 的实现严格对齐。
//  3. 显式取出 TextOID 的 Type 而不是依赖默认行为，能在 pgx 升级 / 内置类型表变动时立刻 panic
//     而不是产生静默的字段类型漂移。
//
// 错误处理：parse / NewWithConfig 失败均带语义包裹返回；AfterConnect 内部失败会让该连接被池丢弃。
func NewPool(ctx context.Context, dbURL string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	cfg.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		m := conn.TypeMap()
		textType, ok := m.TypeForOID(pgtype.TextOID)
		if !ok {
			return fmt.Errorf("text type not registered")
		}
		m.RegisterType(&pgtype.Type{
			Name:  "numeric",
			OID:   pgtype.NumericOID,
			Codec: textType.Codec,
		})
		return nil
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}
	return pool, nil
}
