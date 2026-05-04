/*
@file metadata.go
@description 把请求元数据（client IP / User-Agent）注入 request.Context()，
             供 7 个 service Create 路径写入 7 张活动事件源表的 client_ip/user_agent 列。

             业务背景（用户原话 2026-05-03）：
                 "需要在反馈、状态、创建 tag 右侧显示提交当前时间线的用户账号的功能,
                  这样时间线信息才完整"
             审计四件套：actorUsername + clientIP + userAgent + dwellMs/attachmentCount

             架构决策（避免循环依赖）：
                 - 类型 RequestMetadata + ctx helper 在 services 包定义（services/request_metadata.go）
                 - 本中间件仅做 *http.Request → services.RequestMetadata 提取并注入

             选型决策：
                 - IP 来源：r.RemoteAddr（Tauri 直连本机 127.0.0.1；未来加反代时再考虑
                   X-Forwarded-For 优先）
                 - UA 来源：r.Header.Get("User-Agent")（Tauri WKWebView 自带 Mozilla...
                   含系统/版本信息，便于审计区分）

@author Atlas.oi
@date 2026-05-03
*/

package middleware

import (
	"net"
	"net/http"

	"github.com/ghostterm/progress-server/internal/services"
)

// InjectRequestMetadata 提取 r.RemoteAddr + User-Agent 注入 ctx。
//
// 业务流程：
//  1. r.RemoteAddr 形如 "127.0.0.1:54321"；用 net.SplitHostPort 拆出 host 部分
//  2. SplitHostPort 失败 → 把 RemoteAddr 原样作为 IP（防御性兜底）
//  3. UA 直接从 header 取，缺失为空串
//  4. 装入 services.RequestMetadata 写 ctx
func InjectRequestMetadata(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		md := services.RequestMetadata{
			ClientIP:  extractClientIP(r),
			UserAgent: r.Header.Get("User-Agent"),
		}
		next.ServeHTTP(w, r.WithContext(services.WithRequestMetadata(r.Context(), md)))
	})
}

// extractClientIP 取客户端 IP；GhostTerm 桌面应用本机 server 模式下，r.RemoteAddr
// 永远是 loopback，所以优先用 server 端 PublicIP() 缓存（同机部署 = server 公网 IP =
// 用户公网 IP）；非 loopback（如未来部署到云端反代场景）才用 RemoteAddr 归一。
//
// 业务背景（用户反馈 2026-05-03）："需要公网IP而不是局域网IP"
// 之前用 r.RemoteAddr 拿到 ::1 / 127.0.0.1 让审计无意义。改后端调 ipify 缓存
// publicIp，启动时 PrimePublicIP() 异步预热，request handler 同步读 cached 值。
//
// 归一化规则（适用于 RemoteAddr 兜底）:
//  1. host == "::1" → "127.0.0.1"（IPv6 loopback ↔ IPv4 loopback 等价）
//  2. IPv4-mapped IPv6 ("::ffff:192.168.1.1") → 取 IPv4 部分 "192.168.1.1"
//  3. 真 IPv6 全球地址保留原样
func extractClientIP(r *http.Request) string {
	host := remoteAddrHost(r.RemoteAddr)
	// loopback 时优先用 server 端缓存的公网 IP（桌面应用同机模式 server 公网 = 用户公网）
	if isLoopback(host) {
		if pub := PublicIP(); pub != "" {
			return pub
		}
		// publicIp 未就绪 / fetch 失败 → 维持 loopback 归一化（首次请求或外网失败时）
		return "127.0.0.1"
	}
	if parsed := net.ParseIP(host); parsed != nil {
		if v4 := parsed.To4(); v4 != nil {
			return v4.String()
		}
	}
	return host
}

// remoteAddrHost 从 r.RemoteAddr 拆出 IP 部分。
func remoteAddrHost(remoteAddr string) string {
	if remoteAddr == "" {
		return ""
	}
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return remoteAddr
	}
	return host
}

// isLoopback 检测 IPv4/IPv6 loopback。
func isLoopback(host string) bool {
	if host == "::1" || host == "127.0.0.1" {
		return true
	}
	if parsed := net.ParseIP(host); parsed != nil {
		return parsed.IsLoopback()
	}
	return false
}
