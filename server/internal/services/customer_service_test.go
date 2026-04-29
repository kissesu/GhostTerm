/*
@file customer_service_test.go
@description CustomerService 的单元测试 —— 覆盖纯逻辑分支：
             - NewCustomerService：pool=nil 必返回 error
             - List/Get/Create/Update：sc 类型断言失败必返回 ErrInvalidSessionContext
             - Create：NameWechat 空字符串 → ErrCustomerNameRequired
             - Update：显式提供 NameWechat 为空 → ErrCustomerNameRequired
             - Update：input 不是 UpdateCustomerInput → 类型断言错误（不返回 ErrInvalidSessionContext）

             不在本文件做：
             - DB 集成测试（真实 RLS 拦截 / 跨用户可见性）放 tests/integration/customer_test.go
@author Atlas.oi
@date 2026-04-29
*/

package services

import (
	"context"
	"errors"
	"testing"
)

// ============================================================
// NewCustomerService 构造校验
// ============================================================

func TestNewCustomerService_NilPool(t *testing.T) {
	_, err := NewCustomerService(CustomerServiceDeps{Pool: nil})
	if err == nil {
		t.Fatal("expected error for nil pool, got nil")
	}
}

// ============================================================
// SessionContext 类型断言失败
// 所有 4 个方法都应在 sc 类型不对时返回 ErrInvalidSessionContext
// ============================================================

// fakeSessionContext 一个不是 AuthContext 的 SessionContext 实现，
// 用来触发 service 的 type assertion 失败分支。
type fakeSessionContext struct{}

func TestCustomerService_AllMethods_RejectInvalidSessionContext(t *testing.T) {
	// pool=nil 也安全：sc assertion 失败发生在任何 DB 调用之前
	svc := &customerService{pool: nil}
	ctx := context.Background()
	bad := fakeSessionContext{}

	t.Run("List", func(t *testing.T) {
		_, err := svc.List(ctx, bad, PageQuery{})
		if !errors.Is(err, ErrInvalidSessionContext) {
			t.Errorf("List: expected ErrInvalidSessionContext, got %v", err)
		}
	})

	t.Run("Get", func(t *testing.T) {
		_, err := svc.Get(ctx, bad, 1)
		if !errors.Is(err, ErrInvalidSessionContext) {
			t.Errorf("Get: expected ErrInvalidSessionContext, got %v", err)
		}
	})

	t.Run("Create", func(t *testing.T) {
		_, err := svc.Create(ctx, bad, CreateCustomerInput{NameWechat: "x"})
		if !errors.Is(err, ErrInvalidSessionContext) {
			t.Errorf("Create: expected ErrInvalidSessionContext, got %v", err)
		}
	})

	t.Run("Update", func(t *testing.T) {
		name := "x"
		_, err := svc.Update(ctx, bad, 1, UpdateCustomerInput{NameWechat: &name})
		if !errors.Is(err, ErrInvalidSessionContext) {
			t.Errorf("Update: expected ErrInvalidSessionContext, got %v", err)
		}
	})
}

// ============================================================
// Create：input 类型不对 + name 空校验
// ============================================================

func TestCustomerService_Create_WrongInputType(t *testing.T) {
	svc := &customerService{pool: nil}
	// 传 string 而不是 CreateCustomerInput
	_, err := svc.Create(context.Background(), AuthContext{UserID: 1, RoleID: 2}, "not-an-input")
	if err == nil {
		t.Fatal("expected error for wrong input type, got nil")
	}
	// 不应该是 ErrInvalidSessionContext（sc 是合法的 AuthContext）
	if errors.Is(err, ErrInvalidSessionContext) {
		t.Errorf("expected non-session error, got ErrInvalidSessionContext")
	}
}

func TestCustomerService_Create_EmptyName(t *testing.T) {
	svc := &customerService{pool: nil}
	_, err := svc.Create(context.Background(), AuthContext{UserID: 1, RoleID: 2}, CreateCustomerInput{NameWechat: ""})
	if !errors.Is(err, ErrCustomerNameRequired) {
		t.Errorf("expected ErrCustomerNameRequired, got %v", err)
	}
}

// ============================================================
// Update：input 类型不对 + 显式空 name 校验
// ============================================================

func TestCustomerService_Update_WrongInputType(t *testing.T) {
	svc := &customerService{pool: nil}
	_, err := svc.Update(context.Background(), AuthContext{UserID: 1, RoleID: 2}, 1, "not-an-input")
	if err == nil {
		t.Fatal("expected error for wrong input type, got nil")
	}
	if errors.Is(err, ErrInvalidSessionContext) {
		t.Errorf("expected non-session error, got ErrInvalidSessionContext")
	}
}

func TestCustomerService_Update_ExplicitEmptyName(t *testing.T) {
	svc := &customerService{pool: nil}
	empty := ""
	_, err := svc.Update(context.Background(), AuthContext{UserID: 1, RoleID: 2}, 1, UpdateCustomerInput{NameWechat: &empty})
	if !errors.Is(err, ErrCustomerNameRequired) {
		t.Errorf("expected ErrCustomerNameRequired, got %v", err)
	}
}

// ============================================================
// Sentinel error 不变量：每个 sentinel 必须可被 errors.Is 命中
// ============================================================

func TestCustomerService_SentinelErrors(t *testing.T) {
	cases := []struct {
		name string
		err  error
	}{
		{"ErrCustomerNotFound", ErrCustomerNotFound},
		{"ErrCustomerNameRequired", ErrCustomerNameRequired},
		{"ErrInvalidSessionContext", ErrInvalidSessionContext},
	}
	for _, c := range cases {
		if c.err == nil {
			t.Errorf("%s 必须非 nil", c.name)
			continue
		}
		// 自我 errors.Is 校验
		if !errors.Is(c.err, c.err) {
			t.Errorf("%s 自身 errors.Is 失败", c.name)
		}
	}
}
