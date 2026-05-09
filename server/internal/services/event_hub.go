/*
@file event_hub.go
@description EventHub 内存实现：sync.RWMutex 保护 user→[]chan Event；
             atomic.Int64 全局递增 ID counter；chan 缓冲 64 满则丢弃 + log（spec v3.5 §5）
@author Atlas.oi
@date 2026-05-09
*/
package services

import (
	"log"
	"sync"
	"sync/atomic"
)

// eventChanBuffer 每条订阅 channel 的缓冲大小。
// 64 足够覆盖一次批量推送的抖动；超过时丢弃 + log，由心跳机制兜底让客户端重拉。
const eventChanBuffer = 64

// eventHubImpl 是 EventHub interface 的内存实现。
type eventHubImpl struct {
	mu      sync.RWMutex
	users   map[int64][]chan Event
	counter atomic.Int64
}

// 编译期确认实现了 EventHub interface。
var _ EventHub = (*eventHubImpl)(nil)

// NewEventHub 创建一个新的内存 EventHub 实例。
func NewEventHub() *eventHubImpl {
	return &eventHubImpl{users: make(map[int64][]chan Event)}
}

// Subscribe 注册 userID 的订阅，返回事件 channel 和取消闭包。
// 取消闭包是幂等的（多次调用只执行一次）。
func (h *eventHubImpl) Subscribe(userID int64) (<-chan Event, func()) {
	ch := make(chan Event, eventChanBuffer)
	h.mu.Lock()
	h.users[userID] = append(h.users[userID], ch)
	h.mu.Unlock()

	var once sync.Once
	unsub := func() {
		once.Do(func() {
			h.mu.Lock()
			defer h.mu.Unlock()
			chans := h.users[userID]
			for i, c := range chans {
				if c == ch {
					// 用末尾元素覆盖当前位置，避免内存泄漏
					chans[i] = chans[len(chans)-1]
					chans = chans[:len(chans)-1]
					break
				}
			}
			if len(chans) == 0 {
				delete(h.users, userID)
			} else {
				h.users[userID] = chans
			}
			close(ch)
		})
	}
	return ch, unsub
}

// Publish 将事件广播给所有 TargetUserIDs 中的在线订阅者。
// channel 满时丢弃事件并打日志；心跳帧会让客户端检测到 latestId 落后并主动重拉。
func (h *eventHubImpl) Publish(evt Event) {
	// 先分配单调递增 ID，再路由投递
	evt.ID = h.counter.Add(1)
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, uid := range evt.TargetUserIDs {
		for _, ch := range h.users[uid] {
			select {
			case ch <- evt:
			default:
				// chan 满，丢弃并记录日志；心跳侦测兜底让客户端重拉
				log.Printf("event_hub: drop event userID=%d eventID=%d type=%s（chan 满，等心跳侦测兜底）", uid, evt.ID, evt.Type)
			}
		}
	}
}

// LatestEventID 返回当前已发布的最大事件 ID（未发布过时为 0）。
func (h *eventHubImpl) LatestEventID() int64 {
	return h.counter.Load()
}

// OnlineUsers 返回当前在线 userID→连接数 map（用于心跳日志/监控）。
func (h *eventHubImpl) OnlineUsers() map[int64]int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make(map[int64]int, len(h.users))
	for uid, chans := range h.users {
		out[uid] = len(chans)
	}
	return out
}
