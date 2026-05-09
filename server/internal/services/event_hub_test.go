/*
@file event_hub_test.go
@description EventHub 内存实现单元测试（6 cases）。
             覆盖：单调递增 ID / 订阅收事件 / 非目标不收 / 慢消费不阻塞 / 取消订阅清理 / 并发安全
@author Atlas.oi
@date 2026-05-09
*/
package services

import (
	"sync"
	"testing"
	"time"
)

func TestEventHub_PublishAssignsMonotonicID(t *testing.T) {
	h := NewEventHub()
	if got := h.LatestEventID(); got != 0 {
		t.Fatalf("初始 LatestEventID 应为 0，got %d", got)
	}
	h.Publish(Event{Type: EventProjectCreated, TargetUserIDs: []int64{1}})
	if got := h.LatestEventID(); got != 1 {
		t.Fatalf("第一个 Publish 后应为 1，got %d", got)
	}
	h.Publish(Event{Type: EventProjectUpdated, TargetUserIDs: []int64{1}})
	if got := h.LatestEventID(); got != 2 {
		t.Fatalf("第二个 Publish 后应为 2，got %d", got)
	}
}

func TestEventHub_SubscribeReceivesEvent(t *testing.T) {
	h := NewEventHub()
	ch, unsub := h.Subscribe(42)
	defer unsub()
	h.Publish(Event{Type: EventProjectCreated, TargetUserIDs: []int64{42}, Data: map[string]any{"name": "demo"}})
	select {
	case evt := <-ch:
		if evt.Type != EventProjectCreated {
			t.Errorf("type = %s; 应是 project.created", evt.Type)
		}
		if evt.ID != 1 {
			t.Errorf("ID = %d; 应是 1", evt.ID)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("100ms 内未收到事件")
	}
}

func TestEventHub_NonTargetUserNotReceives(t *testing.T) {
	h := NewEventHub()
	chOther, unsub := h.Subscribe(99)
	defer unsub()
	h.Publish(Event{Type: EventProjectCreated, TargetUserIDs: []int64{42}})
	select {
	case <-chOther:
		t.Fatal("非目标 user 不应收到事件")
	case <-time.After(50 * time.Millisecond):
	}
}

func TestEventHub_SlowConsumerDoesNotBlock(t *testing.T) {
	h := NewEventHub()
	_, unsub := h.Subscribe(1) // 不读取这个 chan，模拟慢消费
	defer unsub()
	done := make(chan struct{})
	go func() {
		// 推 200 条 ≫ chan 缓冲 64 → 应丢弃但不阻塞
		for i := 0; i < 200; i++ {
			h.Publish(Event{Type: EventProjectCreated, TargetUserIDs: []int64{1}})
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("慢消费阻塞了 publish")
	}
}

func TestEventHub_UnsubscribeRemovesUser(t *testing.T) {
	h := NewEventHub()
	_, unsub := h.Subscribe(1)
	if got := h.OnlineUsers(); got[1] != 1 {
		t.Fatalf("订阅后 online[1] 应为 1，got %d", got[1])
	}
	unsub()
	if got := h.OnlineUsers(); len(got) != 0 {
		t.Fatalf("取消订阅后 OnlineUsers 应空，got %v", got)
	}
}

func TestEventHub_ConcurrentSubscribePublish(t *testing.T) {
	h := NewEventHub()
	var wg sync.WaitGroup
	// 100 个并发订阅 + 100 个并发推送，不能 panic / race
	for i := int64(1); i <= 100; i++ {
		wg.Add(1)
		go func(uid int64) {
			defer wg.Done()
			_, unsub := h.Subscribe(uid)
			defer unsub()
			time.Sleep(10 * time.Millisecond)
		}(i)
	}
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			h.Publish(Event{Type: EventProjectCreated, TargetUserIDs: []int64{1, 2, 3}})
		}()
	}
	wg.Wait()
}
