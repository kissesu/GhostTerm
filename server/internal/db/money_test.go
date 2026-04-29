/*
@file money_test.go
@description Money 类型边界单测 —— 覆盖小数位限制、StringFixed、JSON、driver.Value/Scan，
             不依赖 DB 容器。集成路径（pgx round-trip + SUM 聚合）见 tests/integration/money_test.go。
@author Atlas.oi
@date 2026-04-29
*/

package db

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestMoneyFromString_Boundaries(t *testing.T) {
	cases := []struct {
		in      string
		want    string
		wantErr bool
	}{
		{"0.00", "0.00", false},
		{"0.01", "0.01", false},
		{"1.50", "1.50", false},
		{"9999999999.99", "9999999999.99", false},
		{"-100.50", "-100.50", false},
		{"1.99", "1.99", false},
		{"5", "5.00", false},      // 整数 → 补 .00
		{"5.5", "5.50", false},    // 1 位小数 → 补 .50
		{"1.234", "", true},       // 3 位小数：拒绝
		{"-0.001", "", true},      // 3 位小数（负）
		{"abc", "", true},         // 非数字
	}
	for _, c := range cases {
		c := c
		t.Run(c.in, func(t *testing.T) {
			m, err := MoneyFromString(c.in)
			if c.wantErr {
				if err == nil {
					t.Fatalf("expected error for %q, got nil", c.in)
				}
				return
			}
			if err != nil {
				t.Fatalf("MoneyFromString(%q): %v", c.in, err)
			}
			if got := m.StringFixed(2); got != c.want {
				t.Errorf("StringFixed(2) for %q = %q; want %q", c.in, got, c.want)
			}
		})
	}
}

func TestMoney_DriverValue(t *testing.T) {
	m, err := MoneyFromString("123.4")
	if err != nil {
		t.Fatalf("MoneyFromString: %v", err)
	}
	v, err := m.Value()
	if err != nil {
		t.Fatalf("Value: %v", err)
	}
	s, ok := v.(string)
	if !ok {
		t.Fatalf("Value should return string, got %T", v)
	}
	if s != "123.40" {
		t.Errorf("Value = %q; want %q", s, "123.40")
	}
}

func TestMoney_Scan(t *testing.T) {
	cases := []struct {
		name    string
		src     any
		want    string
		wantErr bool
	}{
		{"string", "123.45", "123.45", false},
		{"bytes", []byte("99.99"), "99.99", false},
		{"nil-becomes-zero", nil, "0.00", false},
		{"empty-string-becomes-zero", "", "0.00", false},
		{"whitespace-trimmed", "  42.5  ", "42.50", false},
		{"reject-int", 100, "", true},
		{"reject-float", 1.23, "", true},
		{"reject-bool", true, "", true},
		{"reject-bad-string", "not-a-number", "", true},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			var m Money
			err := m.Scan(c.src)
			if c.wantErr {
				if err == nil {
					t.Fatalf("expected error scanning %v (%T), got nil", c.src, c.src)
				}
				return
			}
			if err != nil {
				t.Fatalf("Scan: %v", err)
			}
			if got := m.StringFixed(2); got != c.want {
				t.Errorf("StringFixed(2) = %q; want %q", got, c.want)
			}
		})
	}
}

func TestMoney_JSON_Roundtrip(t *testing.T) {
	in, err := MoneyFromString("12345.67")
	if err != nil {
		t.Fatalf("MoneyFromString: %v", err)
	}
	data, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	if string(data) != `"12345.67"` {
		t.Errorf("Marshal = %s; want %q", data, `"12345.67"`)
	}
	var out Money
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if got := out.StringFixed(2); got != "12345.67" {
		t.Errorf("Unmarshal value = %q; want %q", got, "12345.67")
	}
}

func TestMoney_JSON_RejectsThreeDecimals(t *testing.T) {
	var m Money
	err := json.Unmarshal([]byte(`"1.234"`), &m)
	if err == nil {
		t.Fatal("expected error for 3-decimal JSON")
	}
}

func TestMoney_JSON_RejectsNonString(t *testing.T) {
	var m Money
	err := json.Unmarshal([]byte(`123.45`), &m)
	if err == nil {
		t.Fatal("expected error for numeric JSON literal (must be string)")
	}
	if !strings.Contains(err.Error(), "string") {
		t.Errorf("error should mention string requirement, got: %v", err)
	}
}
