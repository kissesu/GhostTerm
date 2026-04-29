/*
@file money_test.go
@description Money 类型 pgx 端到端集成测试 —— 验证 v2 part5 §NC5-fix 的 NUMERIC text codec 注册
             在 round-trip / 聚合 SUM / 边界值（0/0.01/最大/负数）下都不丢精度。
             每个用例独自启动容器（StartPostgres 内置），避免共享池污染。
@author Atlas.oi
@date 2026-04-29
*/

package integration

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ghostterm/progress-server/internal/db"
	"github.com/ghostterm/progress-server/internal/testutil"
)

func TestMoney_NumericTextCodec(t *testing.T) {
	pool, cleanup := testutil.StartPostgres(t)
	defer cleanup()

	ctx := context.Background()
	cases := []struct{ in, want string }{
		{"0.00", "0.00"},
		{"0.01", "0.01"},
		{"1.50", "1.50"},
		{"9999999999.99", "9999999999.99"},
		{"-100.50", "-100.50"},
		{"1234567890.12", "1234567890.12"},
	}
	for _, c := range cases {
		c := c
		t.Run(c.in, func(t *testing.T) {
			var out db.Money
			err := pool.QueryRow(ctx, `SELECT $1::numeric(12,2)`, c.in).Scan(&out)
			require.NoError(t, err)
			assert.Equal(t, c.want, out.StringFixed(2))
		})
	}
}

func TestMoney_AggregateSum(t *testing.T) {
	pool, cleanup := testutil.StartPostgres(t)
	defer cleanup()

	ctx := context.Background()
	_, err := pool.Exec(ctx, `CREATE TEMP TABLE t (amount numeric(12,2))`)
	require.NoError(t, err)
	defer func() {
		_, _ = pool.Exec(ctx, `DROP TABLE t`)
	}()

	inputs := []string{"100.50", "200.25", "0.01", "9999999999.99"}
	for _, v := range inputs {
		_, err := pool.Exec(ctx, `INSERT INTO t VALUES ($1::numeric(12,2))`, v)
		require.NoError(t, err)
	}
	var total db.Money
	err = pool.QueryRow(ctx, `SELECT SUM(amount) FROM t`).Scan(&total)
	require.NoError(t, err)
	assert.Equal(t, "10000000300.75", total.StringFixed(2))
}

func TestMoney_RejectsExtraDecimals(t *testing.T) {
	_, err := db.MoneyFromString("1.234")
	assert.Error(t, err)
	_, err = db.MoneyFromString("1.99")
	assert.NoError(t, err)
}
