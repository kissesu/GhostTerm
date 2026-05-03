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

// extractClientIP 从 r.RemoteAddr 取 IP（去端口）。
func extractClientIP(r *http.Request) string {
	if r.RemoteAddr == "" {
		return ""
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
