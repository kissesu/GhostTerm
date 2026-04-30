/*
@file ws_hub.go
@description WSHub 的具体实现：维护 user_id → []*websocket.Conn 注册表，
             支持 NotificationService.FlushOutbox 调用 Broadcast 推送通知。

             并发安全保证（v2 part2 §W3 + part1 §C6）：
             - 内部 map 用 sync.RWMutex 保护
             - RegisterClient 返回 deregister 闭包，客户端主动调用即可清理
             - Broadcast 在 RLock 下复制连接切片再 unlock，写消息时不持锁，
               避免单个慢客户端阻塞整个 hub
             - WriteJSON 失败的连接不主动 close（让 ws read loop 自身检测断线后调用 deregister）

             写入超时：每次 WriteJSON 前调 SetWriteDeadline(now+5s)，避免某个网络慢的连接
             把整个 outbox flush 卡死。
@author Atlas.oi
@date 2026-04-29
*/

package services

import (
	"errors"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// ErrNoSubscribers WSHub.Broadcast 找不到目标用户的在线连接时返回。
//
// 业务语义：用户离线（未连 WS）；调用方（outbox worker）应吞掉这个错误，
// 让通知保留 delivered_at IS NULL 状态，等用户上线后下次 flush 推送。
// 注：当前实现采用"广播即标记 delivered"策略 —— 离线时 delivered_at 仍写入，
// 用户上线后通过 GET /api/notifications 主动拉取。outbox 仅用于"在线即时推送"。
var ErrNoSubscribers = errors.New("ws_hub: no subscribers")

// wsWriteTimeout 单次 WriteJSON 的超时；超过后判定该连接失效但不立即关闭，
// 由对应连接的 read loop 自行检测异常后 deregister。
const wsWriteTimeout = 5 * time.Second

// wsHub 是 WSHub 的具体实现。
type wsHub struct {
	mu      sync.RWMutex
	clients map[int64][]*websocket.Conn
}

// 编译时校验
var _ WSHub = (*wsHub)(nil)

// NewWSHub 构造一个空的 WSHub。
func NewWSHub() *wsHub {
	return &wsHub{
		clients: make(map[int64][]*websocket.Conn),
	}
}

// RegisterClient 注册一条新的 WS 连接到指定用户的列表。
//
// 业务流程：
//  1. 加写锁 → 把 conn append 到 clients[userID]
//  2. 返回 deregister 闭包，调用即从 list 中移除该 conn
//
// 参数 conn 接口签名为 any 是为了让 services 包不依赖 gorilla/websocket（保持 interface
// 在 services 层无第三方耦合）；运行时这里立即断言为 *websocket.Conn，传错类型直接 fail-fast。
//
// 设计取舍：
//   - 用闭包返回 deregister 而非"unregister(userID, conn)"两参数方法：
//     调用方少传一个参数，且无法误传"别人的 conn"
//   - 闭包是幂等的：同一 deregister 多次调用不会 panic（找不到对应 conn 直接返回）
func (h *wsHub) RegisterClient(userID int64, conn any) func() {
	wsConn, ok := conn.(*websocket.Conn)
	if !ok {
		// fail-fast：错误类型只能是程序员错配，不应静默接受
		panic("ws_hub: RegisterClient requires *websocket.Conn")
	}
	h.mu.Lock()
	h.clients[userID] = append(h.clients[userID], wsConn)
	h.mu.Unlock()

	var once sync.Once
	return func() {
		once.Do(func() {
			h.mu.Lock()
			defer h.mu.Unlock()
			conns := h.clients[userID]
			for i, c := range conns {
				if c == wsConn {
					// 删除第 i 个：用 swap-and-pop 避免 O(n) 移动（顺序无关紧要）
					conns[i] = conns[len(conns)-1]
					conns = conns[:len(conns)-1]
					break
				}
			}
			if len(conns) == 0 {
				delete(h.clients, userID)
			} else {
				h.clients[userID] = conns
			}
		})
	}
}

// Broadcast 把通知 JSON 推送给目标用户的所有在线连接。
//
// 业务流程：
//  1. RLock 下复制连接切片 → unlock（避免持锁写消息阻塞其它 Register/Deregister）
//  2. 对每条连接 SetWriteDeadline + WriteJSON；失败仅记录不向上传播错误
//  3. 若 clients[userID] 不存在或切片空 → 返回 ErrNoSubscribers
func (h *wsHub) Broadcast(n Notification) error {
	h.mu.RLock()
	conns := append([]*websocket.Conn(nil), h.clients[n.UserID]...)
	h.mu.RUnlock()

	if len(conns) == 0 {
		return ErrNoSubscribers
	}

	for _, c := range conns {
		// 单连接写超时；若某个连接写失败不影响其它连接
		_ = c.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
		if err := c.WriteJSON(n); err != nil {
			// 写失败不在此处 close —— read loop 检测到连接错后会自行 deregister
			continue
		}
	}
	return nil
}

// ClientCount 返回某用户的在线连接数（测试 / 监控用）。
func (h *wsHub) ClientCount(userID int64) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients[userID])
}

// TotalUsers 返回当前在线用户数（测试 / 监控用）。
func (h *wsHub) TotalUsers() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}
