/*
@file notification_service_test.go
@description NotificationService 单元测试 —— 覆盖纯逻辑分支（不触 DB）：
             - NewNotificationService 必填校验
             - Create 类型白名单
             - Create 空 title/body
             - FlushOutbox(hub=nil) 应直接 noop 返回 nil
             - validNotificationTypes 与 0001 migration enum 同步
@author Atlas.oi
@date 2026-04-29
*/

package services

import (
	"context"
	"errors"
	"testing"
)

func TestNewNotificationService_RequiresPool(t *testing.T) {
	_, err := NewNotificationService(NotificationServiceDeps{Pool: nil})
	if err == nil {
		t.Fatal("Pool=nil 应返回 error")
	}
}

// ============================================================
// Create 类型白名单
// pool 为 nil；类型白名单校验在 DB 调用之前完成，不会触碰 nil pool
// ============================================================

func TestCreate_RejectsInvalidType(t *testing.T) {
	svc := &notificationService{pool: nil, hub: nil}

	cases := []string{
		"",
		"unknown",
		"NEW_FEEDBACK", // 大小写敏感
		"feedback",     // 漏 prefix
		"deadline",     // 缩写也拒绝
		"; DROP TABLE", // 注入风格
	}
	for _, c := range cases {
		_, err := svc.Create(context.Background(), nil, 1, c, nil, "title", "body")
		if !errors.Is(err, ErrNotificationInvalidType) {
			t.Errorf("type=%q 应返回 ErrNotificationInvalidType，实际 = %v", c, err)
		}
	}
}

// ============================================================
// Create 空 title/body
// ============================================================

func TestCreate_RejectsEmptyTitleOrBody(t *testing.T) {
	svc := &notificationService{pool: nil, hub: nil}

	cases := []struct {
		title string
		body  string
	}{
		{"", "body"},
		{"title", ""},
		{"", ""},
	}
	for _, c := range cases {
		_, err := svc.Create(context.Background(), nil, 1, "ball_passed", nil, c.title, c.body)
		if err == nil {
			t.Errorf("title=%q body=%q 应返回 error", c.title, c.body)
		}
		// 不应被识别为类型错误
		if errors.Is(err, ErrNotificationInvalidType) {
			t.Error("空 title/body 不应被映射为 ErrNotificationInvalidType")
		}
	}
}

// ============================================================
// FlushOutbox hub=nil 应 noop
// ============================================================

func TestFlushOutbox_NilHubNoop(t *testing.T) {
	svc := &notificationService{pool: nil, hub: nil}

	// hub=nil 时 FlushOutbox 应直接返回 nil，不触碰 pool（pool=nil 也安全）
	if err := svc.FlushOutbox(context.Background()); err != nil {
		t.Errorf("hub=nil 时 FlushOutbox 应返回 nil，实际 = %v", err)
	}
}

// ============================================================
// validNotificationTypes 与 0001 migration enum 同步守护
// ============================================================
//
// 业务背景：feedback 教训"跨语言常量必须单一来源"。
// DB enum / openapi.yaml / Go 白名单三处任一漂移会导致请求被静默接受/拒绝。
// 本测试守护 Go 白名单一边；DB enum 一边由集成测试承担。

func TestValidNotificationTypes_MatchesMigration(t *testing.T) {
	expected := []string{
		"ball_passed",
		"deadline_approaching",
		"overdue",
		"new_feedback",
		"settlement_received",
		"project_terminated",
	}
	if len(validNotificationTypes) != len(expected) {
		t.Fatalf("白名单数量不一致：got %d, want %d", len(validNotificationTypes), len(expected))
	}
	for _, e := range expected {
		if !validNotificationTypes[e] {
			t.Errorf("白名单缺失 %q（migration enum 中存在）", e)
		}
	}
}

// ============================================================
// NewOutboxWorker(svc=nil) 返回 nil
// ============================================================

func TestNewOutboxWorker_NilSvcReturnsNil(t *testing.T) {
	w := NewOutboxWorker(OutboxWorkerDeps{Svc: nil})
	if w != nil {
		t.Errorf("svc=nil 应返回 nil OutboxWorker，实际 = %+v", w)
	}
}

// ============================================================
// OutboxWorker.Run(nil receiver) 直接退出
// ============================================================

func TestOutboxWorker_Run_NilReceiverDoesNotPanic(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("nil OutboxWorker.Run 不应 panic，实际 panic: %v", r)
		}
	}()
	var w *OutboxWorker
	w.Run(context.Background())
}
