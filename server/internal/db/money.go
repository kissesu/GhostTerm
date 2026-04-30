/*
@file money.go
@description Money 类型 —— NUMERIC(12,2) 列的 Go 表示。
             配合 pool.go 注册的 NUMERIC→text codec，全链路走 string 编解码：
             - JSON 序列化为 "123.45"（与 OpenAPI Money pattern 对齐）
             - pgx 写入时 Value() 返回 string，pgx 走 text codec → NUMERIC
             - pgx 读取时 Scan(string) 反向解码
             禁止 3+ 位小数（避免精度静默截断引发对账错误）。
@author Atlas.oi
@date 2026-04-29
*/

package db

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/shopspring/decimal"
)

// Money 是 NUMERIC(12,2) 列的 Go 表示。
//
// 设计取舍（v2 part4 §NC4 / part5 §NC5-fix）：
//  1. 嵌入 decimal.Decimal 而不是 type alias —— 自动获得 Add/Sub/Cmp 等代数方法
//     和 StringFixed，不需要逐个手工转发。
//  2. 不直接用 decimal.Decimal —— 我们要在 Value/Scan/JSON 三处控制成 string 形式，
//     与 OpenAPI 契约对齐。
//  3. NUMERIC(12,2) 范围 -9999999999.99 ~ 9999999999.99（10 位整数 + 2 位小数）；本类型不在
//     Go 侧做范围校验，依赖 Postgres 列约束做最终保证（避免双重维护）。
type Money struct {
	decimal.Decimal
}

// MoneyFromString 从字符串构造 Money，拒绝 3+ 位小数。
//
// 业务规则：
//   - 接受 0/1/2 位小数（包括 "10"、"10.5"、"10.50"）
//   - 拒绝 "1.234" 这类 3+ 位小数（防止前端错误传入精度更高的数被静默截断，导致对账偏差）
//
// shopspring/decimal 的 Exponent() 返回小数点右移位数的负值（"1.99" → -2，"1.234" → -3）。
func MoneyFromString(s string) (Money, error) {
	d, err := decimal.NewFromString(s)
	if err != nil {
		return Money{}, fmt.Errorf("invalid money: %s", s)
	}
	if d.Exponent() < -2 {
		return Money{}, fmt.Errorf("money has more than 2 decimal places: %s", s)
	}
	return Money{d}, nil
}

// StringFixed 显式覆盖嵌入 decimal.Decimal 的同名方法，保证调用 m.StringFixed(2)
// 一直回到 decimal.Decimal 的实现（防止未来在 Money 上加新字段时方法集变动）。
func (m Money) StringFixed(places int32) string {
	return m.Decimal.StringFixed(places)
}

// Value 返回 driver.Value 给 pgx 写入。
//
// 业务约定：始终输出 2 位小数（"5" → "5.00"，"5.5" → "5.50"），与 NUMERIC(12,2) 列字面一致，
// 也与 OpenAPI Money pattern 对齐。
func (m Money) Value() (driver.Value, error) {
	return m.StringFixed(2), nil
}

// Scan 接收 pgx text codec 解出的字符串，拒绝其它类型。
//
// 业务背景：pool.go 已把 NUMERIC OID 切到 text codec，pgx 必然给到 string / []byte；
// 出现 int / float64 / pgtype.Numeric 等其它类型说明 codec 注册失效，应立即报错而不是静默兼容。
func (m *Money) Scan(src any) error {
	if src == nil {
		m.Decimal = decimal.Zero
		return nil
	}
	var s string
	switch v := src.(type) {
	case string:
		s = v
	case []byte:
		s = string(v)
	default:
		return fmt.Errorf("unsupported scan source for Money: %T", src)
	}
	s = strings.TrimSpace(s)
	if s == "" {
		m.Decimal = decimal.Zero
		return nil
	}
	d, err := decimal.NewFromString(s)
	if err != nil {
		return fmt.Errorf("scan money: %w", err)
	}
	m.Decimal = d
	return nil
}

// MarshalJSON 序列化为 JSON 字符串，例如 `"123.45"`。
//
// 业务背景：OpenAPI 中 Money 字段定义为 `type: string, pattern: "^-?\\d+(\\.\\d{1,2})?$"`，
// 不能用数值类型（避免 JS 浮点损失精度）。
func (m Money) MarshalJSON() ([]byte, error) {
	return json.Marshal(m.StringFixed(2))
}

// UnmarshalJSON 从 JSON 字符串反序列化（例如 `"123.45"`）。
//
// 与 MoneyFromString 共用同一组校验：拒绝 3+ 位小数。
func (m *Money) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return fmt.Errorf("money json must be string: %w", err)
	}
	parsed, err := MoneyFromString(s)
	if err != nil {
		return err
	}
	*m = parsed
	return nil
}
