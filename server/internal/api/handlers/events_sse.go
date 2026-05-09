/**
 * @file events_sse.go
 * @description SSE handler GET /api/events?ticket=<base64url>
 *              ticket 校验 → Subscribe → 流式推送事件帧 + 30s 心跳（携带 latestEventId）
 *              chi 直接挂，不走 ogen（ogen 不支持 streaming response）
 *              首次连接立即推一次心跳让客户端获取 latestID 基线
 * @author Atlas.oi
 * @date 2026-05-09
 */
package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/ghostterm/progress-server/internal/services"
)

// heartbeatInterval 心跳间隔，保持连接并同步当前 latestEventID
const heartbeatInterval = 30 * time.Second

// NewEventsSSEHandler 创建 SSE 事件流 handler。
//
// 业务流程：
// 1. 从 query 取 ticket；空 → 401
// 2. VerifyWSTicket 校验（一次性消费）→ 取 AuthContext.UserID
// 3. 设置 SSE 响应头，立即 flush 让反代不缓冲
// 4. 订阅 EventHub，进入事件/心跳/断开三路 select 循环
func NewEventsSSEHandler(authSvc services.AuthService, hub services.EventHub) http.HandlerFunc {
	// fail-fast：构造期检查依赖，不允许带 nil 上线
	if authSvc == nil {
		panic("NewEventsSSEHandler: authSvc is required")
	}
	if hub == nil {
		panic("NewEventsSSEHandler: hub is required")
	}

	return func(w http.ResponseWriter, r *http.Request) {
		// ============================================
		// 第一步：ticket 校验（与 ws.go 对称）
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
		// 第二步：检查 ResponseWriter 是否支持 streaming
		// ============================================
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}

		// ============================================
		// 第三步：写 SSE 响应头
		// X-Accel-Buffering: no 告诉 nginx/Caddy 禁止缓冲此响应
		// ============================================
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")
		w.WriteHeader(http.StatusOK)
		flusher.Flush()

		// ============================================
		// 第四步：订阅 EventHub，设置心跳定时器
		// ============================================
		ch, unsub := hub.Subscribe(ac.UserID)
		defer unsub()

		ticker := time.NewTicker(heartbeatInterval)
		defer ticker.Stop()

		ctx := r.Context()

		// 立即推一次心跳让客户端拿到 latestID 基线，
		// 避免连接建立到第一次心跳的 30s 窗口内客户端不知道当前水位
		if err := writeHeartbeat(w, flusher, hub.LatestEventID()); err != nil {
			log.Printf("sse handler: initial heartbeat write error (user=%d): %v", ac.UserID, err)
			return
		}

		// ============================================
		// 第五步：事件循环
		// ============================================
		for {
			select {
			case <-ctx.Done():
				// 客户端断开或 server 关闭
				return
			case evt, alive := <-ch:
				if !alive {
					// EventHub 关闭了 channel（服务关停）
					return
				}
				if err := writeEvent(w, flusher, evt); err != nil {
					log.Printf("sse handler: event write error (user=%d): %v", ac.UserID, err)
					return
				}
			case <-ticker.C:
				if err := writeHeartbeat(w, flusher, hub.LatestEventID()); err != nil {
					log.Printf("sse handler: heartbeat write error (user=%d): %v", ac.UserID, err)
					return
				}
			}
		}
	}
}

// writeEvent 将事件帧以 SSE data: 格式写入响应流并立即 flush。
func writeEvent(w http.ResponseWriter, f http.Flusher, evt services.Event) error {
	body, err := json.Marshal(evt)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "data: %s\n\n", body); err != nil {
		return err
	}
	f.Flush()
	return nil
}

// writeHeartbeat 将心跳帧以 SSE event: heartbeat 格式写入响应流并立即 flush。
// latestID 让客户端知道当前事件水位，用于重连时的 Last-Event-ID 请求头对齐。
func writeHeartbeat(w http.ResponseWriter, f http.Flusher, latestID int64) error {
	body, _ := json.Marshal(services.Heartbeat{LatestID: latestID})
	if _, err := fmt.Fprintf(w, "event: heartbeat\ndata: %s\n\n", body); err != nil {
		return err
	}
	f.Flush()
	return nil
}
