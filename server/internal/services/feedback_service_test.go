/*
@file feedback_service_test.go
@description FeedbackService 的单元测试 —— 覆盖纯输入校验分支：
             - NewFeedbackService 必填校验
             - source/status 白名单
             - content trim 后判空
             - SessionContext 类型断言失败

             不在本文件做：DB 集成测试（实际 INSERT/SELECT/UPDATE 走真实 RLS）放
             tests/integration/feedback_test.go。
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
// NewFeedbackService 必填校验
// ============================================================

func TestNewFeedbackService_RequiresPool(t *testing.T) {
	_, err := NewFeedbackService(FeedbackServiceDeps{Pool: nil})
	if err == nil {
		t.Fatal("Pool=nil 应返回 error")
	}
}

// ============================================================
// 输入校验：content 必填（trim 后判空）
// ============================================================

func TestCreate_ContentEmpty(t *testing.T) {
	// pool 为 nil 但只要校验在 DB 调用之前完成即不会触碰 pool
	svc := &feedbackService{pool: nil}

	cases := []string{
		"",
		" ",
		"\t",
		"\n",
		"   \t\n  ",
	}
	for _, c := range cases {
		_, err := svc.Create(context.Background(),
			AuthContext{UserID: 1, RoleID: 2},
			100, // projectID
			CreateFeedbackInput{Content: c},
		)
		if !errors.Is(err, ErrFeedbackContentEmpty) {
			t.Errorf("content=%q 应返回 ErrFeedbackContentEmpty，实际 = %v", c, err)
		}
	}
}

// ============================================================
// 输入校验：source 白名单
// ============================================================

func TestCreate_InvalidSource(t *testing.T) {
	svc := &feedbackService{pool: nil}

	// 非空且不在白名单 → 拒绝
	_, err := svc.Create(context.Background(),
		AuthContext{UserID: 1, RoleID: 2},
		100,
		CreateFeedbackInput{Content: "ok", Source: "twitter"},
	)
	if !errors.Is(err, ErrFeedbackInvalidSource) {
		t.Errorf("非法 source 应返回 ErrFeedbackInvalidSource，实际 = %v", err)
	}

	// SQL 注入的尝试（即便 PG 用 ::feedback_source 也得拦在 service 层）
	_, err = svc.Create(context.Background(),
		AuthContext{UserID: 1, RoleID: 2},
		100,
		CreateFeedbackInput{Content: "ok", Source: "wechat'; DROP TABLE feedbacks; --"},
	)
	if !errors.Is(err, ErrFeedbackInvalidSource) {
		t.Error("注入风格 source 应被白名单拦下")
	}
}

func TestCreate_AcceptsAllValidSources(t *testing.T) {
	// 单元测试只验证白名单 map 包含 5 项合法值；
	// 不调 svc.Create —— 那条路径走到 DB 层，单元测试不应触发数据库
	for _, src := range []string{"phone", "wechat", "email", "meeting", "other"} {
		if !validFeedbackSources[src] {
			t.Errorf("source=%q 应在白名单中", src)
		}
	}
}

// ============================================================
// 输入校验：status 白名单
// ============================================================

func TestUpdateStatus_InvalidStatus(t *testing.T) {
	svc := &feedbackService{pool: nil}

	cases := []string{
		"",
		"open",        // 不存在的旧枚举
		"closed",      // 不存在
		"PENDING",     // 大小写敏感
		"done; DROP",  // 注入
	}
	for _, st := range cases {
		_, err := svc.UpdateStatus(context.Background(),
			AuthContext{UserID: 1, RoleID: 2},
			1, st,
		)
		if !errors.Is(err, ErrFeedbackInvalidStatus) {
			t.Errorf("status=%q 应返回 ErrFeedbackInvalidStatus，实际 = %v", st, err)
		}
	}
}

func TestUpdateStatus_AcceptsAllValidStatuses(t *testing.T) {
	// 单元测试只验证白名单 map 包含 2 项合法值；不调 svc.UpdateStatus（避免触发 DB）
	for _, st := range []string{"pending", "done"} {
		if !validFeedbackStatuses[st] {
			t.Errorf("status=%q 应在白名单中", st)
		}
	}
}

// ============================================================
// SessionContext 类型断言：非 AuthContext 必须 fail-fast
// ============================================================

func TestList_RequiresAuthContext(t *testing.T) {
	svc := &feedbackService{pool: nil}

	// 不传 AuthContext 而是裸 string，应直接 fail
	_, err := svc.List(context.Background(), "not-auth-context", 100)
	if err == nil {
		t.Error("非 AuthContext sc 应返回 error")
	}
	if errors.Is(err, ErrFeedbackContentEmpty) ||
		errors.Is(err, ErrFeedbackInvalidSource) ||
		errors.Is(err, ErrFeedbackInvalidStatus) {
		t.Error("不应映射成业务 sentinel error")
	}
}

func TestCreate_RequiresAuthContext(t *testing.T) {
	svc := &feedbackService{pool: nil}

	_, err := svc.Create(context.Background(), 12345, 100,
		CreateFeedbackInput{Content: "msg"})
	if err == nil {
		t.Error("非 AuthContext sc 应返回 error")
	}
}

func TestCreate_RequiresValidInputType(t *testing.T) {
	svc := &feedbackService{pool: nil}

	// AuthContext 正确，但 input 不是 CreateFeedbackInput
	_, err := svc.Create(context.Background(),
		AuthContext{UserID: 1, RoleID: 2},
		100,
		"not-an-input-struct",
	)
	if err == nil {
		t.Error("非 CreateFeedbackInput 应返回 error")
	}
}

func TestUpdateStatus_RequiresAuthContext(t *testing.T) {
	svc := &feedbackService{pool: nil}

	_, err := svc.UpdateStatus(context.Background(), nil, 1, "done")
	if err == nil {
		t.Error("nil sc 应返回 error")
	}
}

// ============================================================
// 白名单常量与 enum 同步检查（防御性回归）
// ============================================================

// TestValidFeedbackSourcesMatchesMigration 在白名单偏离 0001 migration enum 时立即失败。
//
// 业务背景："跨语言常量必须单一来源" feedback 教训：
// DB enum / openapi.yaml / Go 白名单三处任一漂移都会导致请求被静默接受/拒绝。
// 本测试守护 Go 白名单一边；DB enum 一边由集成测试承担。
func TestValidFeedbackSourcesMatchesMigration(t *testing.T) {
	expected := []string{"phone", "wechat", "email", "meeting", "other"}
	if len(validFeedbackSources) != len(expected) {
		t.Fatalf("白名单数量不一致：got %d, want %d", len(validFeedbackSources), len(expected))
	}
	for _, e := range expected {
		if !validFeedbackSources[e] {
			t.Errorf("白名单缺失 %q（migration enum 中存在）", e)
		}
	}
}

func TestValidFeedbackStatusesMatchesMigration(t *testing.T) {
	expected := []string{"pending", "done"}
	if len(validFeedbackStatuses) != len(expected) {
		t.Fatalf("白名单数量不一致：got %d, want %d", len(validFeedbackStatuses), len(expected))
	}
	for _, e := range expected {
		if !validFeedbackStatuses[e] {
			t.Errorf("白名单缺失 %q（migration enum 中存在）", e)
		}
	}
}
