/*
@file quote_service_test.go
@description QuoteService 纯逻辑单测 —— 覆盖入参校验分支：
             - reason 必填（空 / 全空白 → ErrQuoteValidation）
             - append / after_sales 缺 delta → ErrQuoteValidation
             - modify 缺 newQuote → ErrQuoteValidation
             - 未知 change_type → ErrQuoteValidation
             - 合法入参各类型放行

             不在本文件做：
             - DB 集成测试（事务原子性 / RLS 隔离 / FOR UPDATE 锁）
               放在 tests/integration/quote_test.go 用真 Postgres 容器跑

@author Atlas.oi
@date 2026-04-29
*/

package services

import (
	"errors"
	"testing"

	progressdb "github.com/ghostterm/progress-server/internal/db"
)

// mustMoney 在测试中构造 db.Money；非法 string 直接 fail，简化每个 case 写法。
func mustMoney(t *testing.T, s string) progressdb.Money {
	t.Helper()
	m, err := progressdb.MoneyFromString(s)
	if err != nil {
		t.Fatalf("mustMoney(%q): %v", s, err)
	}
	return m
}

// ============================================================
// validateQuoteInput：纯函数，无需 DB
// ============================================================

func TestValidateQuoteInput_ReasonRequired(t *testing.T) {
	delta := mustMoney(t, "100")
	cases := []struct {
		name   string
		reason string
	}{
		{"empty", ""},
		{"only_space", "   "},
		{"only_tabs", "\t\t"},
		{"only_newline", "\n"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := validateQuoteInput(&QuoteChangeInput{
				ProjectID:  1,
				ChangeType: QuoteChangeAppend,
				Delta:      &delta,
				Reason:     c.reason,
			})
			if !errors.Is(err, ErrQuoteValidation) {
				t.Fatalf("reason=%q expected ErrQuoteValidation, got %v", c.reason, err)
			}
		})
	}
}

func TestValidateQuoteInput_AppendNeedsDelta(t *testing.T) {
	err := validateQuoteInput(&QuoteChangeInput{
		ProjectID:  1,
		ChangeType: QuoteChangeAppend,
		Delta:      nil, // 漏填
		Reason:     "新增功能",
	})
	if !errors.Is(err, ErrQuoteValidation) {
		t.Fatalf("append missing delta should be validation error, got %v", err)
	}
}

func TestValidateQuoteInput_AfterSalesNeedsDelta(t *testing.T) {
	err := validateQuoteInput(&QuoteChangeInput{
		ProjectID:  1,
		ChangeType: QuoteChangeAfterSales,
		Delta:      nil,
		Reason:     "售后追加",
	})
	if !errors.Is(err, ErrQuoteValidation) {
		t.Fatalf("after_sales missing delta should be validation error, got %v", err)
	}
}

func TestValidateQuoteInput_ModifyNeedsNewQuote(t *testing.T) {
	err := validateQuoteInput(&QuoteChangeInput{
		ProjectID:  1,
		ChangeType: QuoteChangeModify,
		NewQuote:   nil, // 漏填
		Reason:     "让利",
	})
	if !errors.Is(err, ErrQuoteValidation) {
		t.Fatalf("modify missing newQuote should be validation error, got %v", err)
	}
}

func TestValidateQuoteInput_UnknownType(t *testing.T) {
	delta := mustMoney(t, "100")
	err := validateQuoteInput(&QuoteChangeInput{
		ProjectID:  1,
		ChangeType: QuoteChangeType("garbage"),
		Delta:      &delta,
		Reason:     "x",
	})
	if !errors.Is(err, ErrQuoteValidation) {
		t.Fatalf("unknown change_type should be validation error, got %v", err)
	}
}

// finding #9：append/after_sales 的 delta 必须 > 0
//
// 业务背景：OpenAPI Money pattern 历史允许负数（^-?\d+\.\d{2}$），
// 让 delta=-9999.99 可以让 current_quote 倒减、after_sales_total 倒减；
// 项目成员就能改对账总账。三层防御中 service 层是第二道：
//   - 第一层：DB CHECK（兜底）
//   - 第二层：service 层（本测试覆盖）
//   - 第三层：OAS schema PositiveMoney pattern（前端拦截）
func TestValidateQuoteInput_AppendRejectsNonPositiveDelta(t *testing.T) {
	negDelta := mustMoney(t, "-9999.99")
	zeroDelta := mustMoney(t, "0")
	cases := []struct {
		name  string
		delta progressdb.Money
	}{
		{"negative", negDelta},
		{"zero", zeroDelta},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := validateQuoteInput(&QuoteChangeInput{
				ProjectID:  1,
				ChangeType: QuoteChangeAppend,
				Delta:      &c.delta,
				Reason:     "倒扣攻击",
			})
			if !errors.Is(err, ErrQuoteValidation) {
				t.Fatalf("delta=%s expected ErrQuoteValidation, got %v", c.delta.String(), err)
			}
		})
	}
}

func TestValidateQuoteInput_AfterSalesRejectsNonPositiveDelta(t *testing.T) {
	negDelta := mustMoney(t, "-1.00")
	zeroDelta := mustMoney(t, "0.00")
	cases := []struct {
		name  string
		delta progressdb.Money
	}{
		{"negative", negDelta},
		{"zero", zeroDelta},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := validateQuoteInput(&QuoteChangeInput{
				ProjectID:  1,
				ChangeType: QuoteChangeAfterSales,
				Delta:      &c.delta,
				Reason:     "售后倒扣",
			})
			if !errors.Is(err, ErrQuoteValidation) {
				t.Fatalf("delta=%s expected ErrQuoteValidation, got %v", c.delta.String(), err)
			}
		})
	}
}

// finding #9：modify 的 newQuote 必须 >= 0（不能把 current_quote 设成负数）
//
// 注意：modify 的 delta 由 service 计算 = newQuote - oldQuote，可能为负（让利场景），
// 因此 modify 不限制 delta 符号，只限制 newQuote >= 0
func TestValidateQuoteInput_ModifyRejectsNegativeNewQuote(t *testing.T) {
	negNewQuote := mustMoney(t, "-100.00")
	err := validateQuoteInput(&QuoteChangeInput{
		ProjectID:  1,
		ChangeType: QuoteChangeModify,
		NewQuote:   &negNewQuote,
		Reason:     "把报价改成负数",
	})
	if !errors.Is(err, ErrQuoteValidation) {
		t.Fatalf("modify with newQuote=-100 should be ErrQuoteValidation, got %v", err)
	}
}

// modify 的 newQuote=0 是合法的（取消项目报价）
func TestValidateQuoteInput_ModifyAllowsZeroNewQuote(t *testing.T) {
	zeroNewQuote := mustMoney(t, "0.00")
	err := validateQuoteInput(&QuoteChangeInput{
		ProjectID:  1,
		ChangeType: QuoteChangeModify,
		NewQuote:   &zeroNewQuote,
		Reason:     "整单作废",
	})
	if err != nil {
		t.Fatalf("modify with newQuote=0 should be allowed, got %v", err)
	}
}

func TestValidateQuoteInput_HappyPaths(t *testing.T) {
	delta := mustMoney(t, "1500")
	newQuote := mustMoney(t, "6000")

	cases := []struct {
		name string
		in   QuoteChangeInput
	}{
		{"append_with_delta", QuoteChangeInput{
			ProjectID: 1, ChangeType: QuoteChangeAppend, Delta: &delta, Reason: "新增功能",
		}},
		{"modify_with_newQuote", QuoteChangeInput{
			ProjectID: 1, ChangeType: QuoteChangeModify, NewQuote: &newQuote, Reason: "整体让利",
		}},
		{"after_sales_with_delta", QuoteChangeInput{
			ProjectID: 1, ChangeType: QuoteChangeAfterSales, Delta: &delta, Reason: "售后追加 bug 修复",
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if err := validateQuoteInput(&c.in); err != nil {
				t.Fatalf("expected nil error for %s, got %v", c.name, err)
			}
		})
	}
}

// ============================================================
// NewQuoteService：nil pool 必须报错（防御编程）
// ============================================================

func TestNewQuoteService_NilPool(t *testing.T) {
	if _, err := NewQuoteService(nil); err == nil {
		t.Fatal("nil pool should return error")
	}
}
