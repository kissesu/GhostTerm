/*
@file payment_service_test.go
@description PaymentService 单元测试 —— 覆盖纯逻辑分支，不触及 DB：
             - 构造校验：Pool=nil 报错
             - PaymentDirection.IsValid()
             - Create 入参校验：amount/direction/remark/dev_settlement 必填字段
             - Money 类型 Decimal.Sign() 行为校验（防止 0.00 被误判为正数）

             不在本文件做：
             - INSERT/UPDATE 真实 DB 行为（放 tests/integration/payment_test.go）
             - MyEarnings RLS 隔离验证（放集成测试）
@author Atlas.oi
@date 2026-04-29
*/

package services

import (
	"context"
	"errors"
	"testing"
	"time"

	progressdb "github.com/ghostterm/progress-server/internal/db"
)

// ============================================================
// NewPaymentService 必填校验
// ============================================================

func TestNewPaymentService_RequiresPool(t *testing.T) {
	_, err := NewPaymentService(PaymentServiceDeps{Pool: nil})
	if err == nil {
		t.Fatal("Pool=nil 应返回 error")
	}
}

// ============================================================
// PaymentDirection.IsValid()
// ============================================================

func TestPaymentDirection_IsValid(t *testing.T) {
	cases := map[PaymentDirection]bool{
		PaymentDirectionCustomerIn:    true,
		PaymentDirectionDevSettlement: true,
		"":                            false,
		"in":                          false, // 任务说明里的旧命名应被拒绝
		"out":                         false,
		"refund":                      false,
		"unknown":                     false,
	}
	for d, want := range cases {
		if got := d.IsValid(); got != want {
			t.Errorf("Direction(%q).IsValid() = %v; want %v", d, got, want)
		}
	}
}

// ============================================================
// Create 入参校验：amount / direction / remark / settlement-fields
// ============================================================
//
// 关键设计：input 必须先经"应用层校验"才进 InTx。
// pool 用 nil，校验失败应在 InTx 之前返回，pool nil 不会被解引用。
// 校验通过的路径会触碰 pool —— 因此本组测试只覆盖"在 InTx 之前应被拒绝"的分支。

func paymentMustMoney(t *testing.T, s string) progressdb.Money {
	t.Helper()
	m, err := progressdb.MoneyFromString(s)
	if err != nil {
		t.Fatalf("MoneyFromString(%q): %v", s, err)
	}
	return m
}

// makePaymentStubService 构造一个不带 pool 的 service —— pool=nil 时只要"校验失败"分支
// 在 InTx 之前 return，nil pool 不会被解引用。
//
// 命名前缀避免与 rbac_service_test.go 的 makeStubService 冲突。
func makePaymentStubService(_ *testing.T) *paymentService {
	return &paymentService{pool: nil}
}

func TestPaymentService_Create_RejectsInvalidAmount(t *testing.T) {
	s := makePaymentStubService(t)
	sc := AuthContext{UserID: 1, RoleID: 1}

	cases := []struct {
		name    string
		amount  string
		wantErr error
	}{
		{"零金额", "0", ErrPaymentInvalidAmount},
		{"零金额带小数", "0.00", ErrPaymentInvalidAmount},
		{"负数金额", "-100.00", ErrPaymentInvalidAmount},
		{"小负数", "-0.01", ErrPaymentInvalidAmount},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			input := PaymentCreateInput{
				Direction: PaymentDirectionCustomerIn,
				Amount:    paymentMustMoney(t, c.amount),
				PaidAt:    time.Now(),
				Remark:    "测试",
			}
			_, err := s.Create(context.Background(), sc, 1, input)
			if !errors.Is(err, c.wantErr) {
				t.Errorf("amount=%s err = %v; want %v", c.amount, err, c.wantErr)
			}
		})
	}
}

func TestPaymentService_Create_RejectsInvalidDirection(t *testing.T) {
	s := makePaymentStubService(t)
	sc := AuthContext{UserID: 1, RoleID: 1}

	input := PaymentCreateInput{
		Direction: "in", // 非 customer_in / dev_settlement
		Amount:    paymentMustMoney(t, "100.00"),
		PaidAt:    time.Now(),
		Remark:    "测试",
	}
	_, err := s.Create(context.Background(), sc, 1, input)
	if !errors.Is(err, ErrPaymentInvalidDirection) {
		t.Errorf("err = %v; want ErrPaymentInvalidDirection", err)
	}
}

func TestPaymentService_Create_RejectsEmptyRemark(t *testing.T) {
	s := makePaymentStubService(t)
	sc := AuthContext{UserID: 1, RoleID: 1}

	input := PaymentCreateInput{
		Direction: PaymentDirectionCustomerIn,
		Amount:    paymentMustMoney(t, "100.00"),
		PaidAt:    time.Now(),
		Remark:    "", // 空 remark
	}
	_, err := s.Create(context.Background(), sc, 1, input)
	if !errors.Is(err, ErrPaymentRemarkRequired) {
		t.Errorf("err = %v; want ErrPaymentRemarkRequired", err)
	}
}

func TestPaymentService_Create_SettlementRequiresFields(t *testing.T) {
	s := makePaymentStubService(t)
	sc := AuthContext{UserID: 1, RoleID: 1}

	uid := int64(7)
	fid := int64(99)

	cases := []struct {
		name           string
		relatedUserID  *int64
		screenshotID   *int64
		shouldRejectAt bool // 是否应被应用层拒绝（true = 期待 ErrPaymentSettlementMissingFields）
	}{
		{"两者都为 nil", nil, nil, true},
		{"只有 related_user_id", &uid, nil, true},
		{"只有 screenshot_id", nil, &fid, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			input := PaymentCreateInput{
				Direction:     PaymentDirectionDevSettlement,
				Amount:        paymentMustMoney(t, "3000.00"),
				PaidAt:        time.Now(),
				RelatedUserID: c.relatedUserID,
				ScreenshotID:  c.screenshotID,
				Remark:        "结算",
			}
			_, err := s.Create(context.Background(), sc, 1, input)
			if c.shouldRejectAt {
				if !errors.Is(err, ErrPaymentSettlementMissingFields) {
					t.Errorf("err = %v; want ErrPaymentSettlementMissingFields", err)
				}
			}
		})
	}
}

func TestPaymentService_Create_RejectsInvalidSessionContext(t *testing.T) {
	s := makePaymentStubService(t)

	// SessionContext 不是 AuthContext 类型 → service 层立即拒绝
	type bogus struct{}
	_, err := s.Create(context.Background(), bogus{}, 1, PaymentCreateInput{
		Direction: PaymentDirectionCustomerIn,
		Amount:    paymentMustMoney(t, "100.00"),
		PaidAt:    time.Now(),
		Remark:    "x",
	})
	if err == nil {
		t.Error("非法 sc 应返回 error")
	}
}

func TestPaymentService_Create_RejectsInvalidInputType(t *testing.T) {
	s := makePaymentStubService(t)
	sc := AuthContext{UserID: 1, RoleID: 1}

	// 传 string 而不是 PaymentCreateInput
	_, err := s.Create(context.Background(), sc, 1, "not-a-payment-input")
	if err == nil {
		t.Error("input 类型错误应返回 error")
	}
}

// ============================================================
// MyEarnings 入参校验
// ============================================================

func TestPaymentService_MyEarnings_RejectsInvalidSessionContext(t *testing.T) {
	s := makePaymentStubService(t)

	type bogus struct{}
	_, err := s.MyEarnings(context.Background(), bogus{})
	if err == nil {
		t.Error("非法 sc 应返回 error")
	}
}

// ============================================================
// List 入参校验
// ============================================================

func TestPaymentService_List_RejectsInvalidSessionContext(t *testing.T) {
	s := makePaymentStubService(t)

	type bogus struct{}
	_, err := s.List(context.Background(), bogus{}, 1)
	if err == nil {
		t.Error("非法 sc 应返回 error")
	}
}

// ============================================================
// Money 精度边界（防止 0.00 / 0.01 等被错误判定）
// ============================================================
//
// 业务背景：v2 part5 §NC5 要求 Money 全链路 NUMERIC text codec；
// 校验链路依赖 decimal.Decimal.Sign()，本测试守住 0/0.00/0.01 三个临界点。

func TestMoney_SignBoundary(t *testing.T) {
	cases := []struct {
		s         string
		wantSign  int // -1, 0, 1
	}{
		{"0", 0},
		{"0.00", 0},
		{"0.01", 1},
		{"-0.01", -1},
		{"100", 1},
		{"100.00", 1},
		{"-100.00", -1},
	}
	for _, c := range cases {
		m, err := progressdb.MoneyFromString(c.s)
		if err != nil {
			t.Fatalf("MoneyFromString(%q): %v", c.s, err)
		}
		if got := m.Decimal.Sign(); got != c.wantSign {
			t.Errorf("Money(%q).Sign() = %d; want %d", c.s, got, c.wantSign)
		}
	}
}
