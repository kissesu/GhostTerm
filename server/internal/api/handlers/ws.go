/*
@file ws.go
@description WebSocket 升级 handler（Phase 12 Lead）：

             路由：GET /api/ws/notifications?ticket=<base64url>
             非 ogen 生成：ogen 不支持 WS 升级，spec/openapi.yaml 仅声明该 endpoint，
             实际由 router.go 用 chi 直接注册到本 handler。

             业务流程：
              1. 从 query 取 ticket；空 → 401
              2. 调 authSvc.VerifyWSTicket（一次性消费 + 返回 AuthContext）
              3. CheckOrigin：允许 http(s)://localhost:* 和 tauri://localhost
              4. websocket.Upgrade 完成升级
              5. hub.RegisterClient(userID, conn) 拿到 deregister 闭包
              6. 启动 read loop：读到任何消息直接丢弃（v1 客户端不发消息）；
                 read 出错 → deregister + close

             安全考量：
              - ticket 是一次性凭证（consume_ws_ticket SECURITY DEFINER 函数保证），
                即便 query string 被日志记下也无法重放
              - CheckOrigin 显式白名单，不开 *
              - 401 不暴露具体原因（"ticket 不存在 / 已过期"），统一文案防探测

@author Atlas.oi
@date 2026-04-29
*/

package handlers

import (
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"

	"github.com/ghostterm/progress-server/internal/services"
)

// wsReadDeadline 单次 read 超时；超过即认为客户端僵死，触发 deregister。
//
// 业务背景：v1 客户端不主动发消息；服务端用 SetReadDeadline + ping/pong 检测连接活性。
// 本实现依赖 gorilla 默认 ping handler（自动响应 pong）；read loop 拿到 ping 也算"活着"。
const wsReadDeadline = 60 * time.Second

// wsPongWait 收到 pong 后将 deadline 后延的时长。
const wsPongWait = 60 * time.Second

// wsUpgrader 全局复用；CheckOrigin 内联白名单。
//
// 设计取舍：
//   - 全局变量 vs 每次构造：upgrader 是 zero-value safe，全局复用避免 GC 压力
//   - ReadBufferSize / WriteBufferSize 用 4KB（够 JSON 通知，没必要更大）
var wsUpgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		// 空 origin（同源 / 桌面 webview）放行
		if origin == "" {
			return true
		}
		// 白名单：本机开发 + Tauri 桌面壳
		if strings.HasPrefix(origin, "http://localhost") ||
			strings.HasPrefix(origin, "https://localhost") ||
			strings.HasPrefix(origin, "http://127.0.0.1") ||
			origin == "tauri://localhost" {
			return true
		}
		return false
	},
}

// NewWSHandler 构造 WS 升级 handler；返回 chi/net 兼容的 http.HandlerFunc。
//
// 业务流程：
//  1. 从 query 取 ticket
//  2. authSvc.VerifyWSTicket 一次性消费 ticket → AuthContext
//  3. CheckOrigin 由 wsUpgrader 内联完成
//  4. Upgrade → RegisterClient → read loop → deregister + close
//
// 设计取舍：
//   - authSvc / hub 必填：缺失立即 panic（fail-fast，不允许构造空 handler）
//   - read loop 不解析消息只丢弃：v1 协议是单向"server → client"
//   - read 出错时不返回 error 给上层（HTTP 层已升级，没法写 5xx 了），
//     仅 log + close + deregister
func NewWSHandler(authSvc services.AuthService, hub services.WSHub) http.HandlerFunc {
	if authSvc == nil {
		panic("ws handler: authSvc is required")
	}
	if hub == nil {
		panic("ws handler: hub is required")
	}
	return func(w http.ResponseWriter, r *http.Request) {
		// ============================================
		// 第一步：取并校验 ticket
		// ============================================
		ticket := strings.TrimSpace(r.URL.Query().Get("ticket"))
		if ticket == "" {
			http.Error(w, "missing ticket", http.StatusUnauthorized)
			return
		}
		sc, err := authSvc.VerifyWSTicket(r.Context(), ticket)
		if err != nil {
			// 不暴露具体原因（不存在 / 过期 / 已被消费）
			http.Error(w, "invalid ticket", http.StatusUnauthorized)
			return
		}
		ac, ok := sc.(services.AuthContext)
		if !ok {
			http.Error(w, "invalid ticket", http.StatusUnauthorized)
			return
		}

		// ============================================
		// 第二步：升级到 WebSocket
		// CheckOrigin 在 upgrader 内已内联白名单
		// ============================================
		conn, err := wsUpgrader.Upgrade(w, r, nil)
		if err != nil {
			// Upgrade 失败 gorilla 已写过 4xx/5xx；这里只 log
			log.Printf("ws handler: upgrade error: %v", err)
			return
		}

		// ============================================
		// 第三步：注册到 hub + 启动 read loop
		// ============================================
		deregister := hub.RegisterClient(ac.UserID, conn)

		// pong handler：每次收到 pong 重置 read deadline
		_ = conn.SetReadDeadline(time.Now().Add(wsReadDeadline))
		conn.SetPongHandler(func(string) error {
			_ = conn.SetReadDeadline(time.Now().Add(wsPongWait))
			return nil
		})

		// 启动 read loop（同步在当前 goroutine，避免泄露 goroutine）
		// HTTP server 本身已为每个请求开 goroutine，这里阻塞读直到连接关闭即可
		go func() {
			defer func() {
				deregister()
				_ = conn.Close()
			}()
			for {
				// v1 不接受客户端消息；NextReader 返回错误即视为断线
				if _, _, err := conn.NextReader(); err != nil {
					// 正常断开（CloseNormalClosure / GoingAway）不 log，避免噪音
					if !errors.Is(err, websocket.ErrCloseSent) {
						closeErr, ok := err.(*websocket.CloseError)
						if !ok || (closeErr.Code != websocket.CloseNormalClosure &&
							closeErr.Code != websocket.CloseGoingAway) {
							log.Printf("ws handler: read err user=%d: %v", ac.UserID, err)
						}
					}
					return
				}
				// 重置 read deadline，让长连保持活跃
				_ = conn.SetReadDeadline(time.Now().Add(wsReadDeadline))
			}
		}()
	}
}
