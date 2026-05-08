/*
@file realip.go
@description 受信代理 RealIP middleware - 仅在请求来自 trusted CIDR 时信任代理头。
             替代 chi 默认 RealIP（无条件信任 X-Forwarded-For 让审计 IP 可被伪造）。

             业务背景（v2 安全审计 finding #10）：
                 chimw.RealIP 无条件读取 X-Forwarded-For 改写 r.RemoteAddr，攻击者
                 直连 8080 端口带 "X-Forwarded-For: 1.2.3.4" 即可伪造 8 张审计表
                 (project_events / quote_history / payment_history / feedback ...)
                 的 client_ip 列。当部署模式为「外网直连 + Tauri reqwest 转发」时
                 完全不应信任任何代理头；当部署模式为「Caddy 同机反代」时只信任
                 127.0.0.1。

             部署模式映射：
                 - 直连模式（IP:38080）：TrustedProxies=nil，audit IP = TCP RemoteAddr 不可伪造
                 - Caddy 同机反代：TrustedProxies=[127.0.0.1/32, ::1/128]，仅本机 Caddy
                   能注代理头
                 - 公网反代（不推荐）：TrustedProxies=[caddy-public-ip/32]

             与 metadata.go 的关系：
                 TrustedProxyRealIP 在外层先校正 r.RemoteAddr，再由 InjectRequestMetadata
                 把 RemoteAddr 归一化（loopback → 公网 IP 缓存）写入 ctx 给 service 层用。
                 注册顺序由 router.go 保证（RealIP 在 InjectRequestMetadata 之前）。

@author Atlas.oi
@date 2026-05-08
*/

package middleware

import (
	"net"
	"net/http"
	"strings"
)

// TrustedProxyRealIP 仅在请求来自 trusted 白名单 CIDR 时信任 X-Forwarded-For/X-Real-IP，
// 否则保留原始 r.RemoteAddr（fail-safe，避免直连攻击者伪造审计 IP）。
//
// 业务流程：
//  1. 解析 r.RemoteAddr 拿 host IP；不在 trusted 白名单 → 直接 next 不动 RemoteAddr
//  2. 优先取 X-Forwarded-For 最左侧（最接近 client）IP；fallback X-Real-IP
//  3. 解析失败 / 空值 → 保留原 RemoteAddr，不让畸形 header 污染审计
//
// 设计取舍：
//   - 不引第三方库（go-chi/httprate 之类），net 标准库 + strings 即可
//   - 不带端口写回（直接 IP 字符串），下游 InjectRequestMetadata 用 SplitHostPort
//     解析失败时会 fallback 原值，兼容
//   - len(trusted)==0 视为「不信任任何代理头」（默认部署模式 = 直连）
func TrustedProxyRealIP(trusted []net.IPNet) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !isFromTrustedProxy(r, trusted) {
				next.ServeHTTP(w, r)
				return
			}
			// 仅在 trusted 路径上信任代理头
			if newAddr := extractForwardedClientIP(r); newAddr != "" {
				r.RemoteAddr = newAddr
			}
			next.ServeHTTP(w, r)
		})
	}
}

// isFromTrustedProxy 检查 r.RemoteAddr 的 host 部分是否在 trusted CIDR 列表内。
//
// 设计取舍：
//   - trusted 为空时 fail-safe 返回 false（不信任任何代理头）
//   - SplitHostPort 解析失败时把 RemoteAddr 整体当 IP 试一次（防御性兜底，httptest
//     里偶尔会传不带端口的 RemoteAddr）
//   - net.ParseIP 失败 = 非 IP 字符串 → 视为不可信
func isFromTrustedProxy(r *http.Request, trusted []net.IPNet) bool {
	if len(trusted) == 0 {
		return false
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	for _, n := range trusted {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

// extractForwardedClientIP 从 X-Forwarded-For（最左侧）/ X-Real-IP 提取 client IP；
// 命名带 Forwarded 前缀避免与 metadata.go 的 extractClientIP（同包内不同语义）冲突。
//
// 业务流程：
//  1. XFF 存在 → split "," 取第一段 trim → ParseIP 校验 → 返回
//  2. XFF 缺失 / 第一段非 IP → 看 X-Real-IP → ParseIP 校验 → 返回
//  3. 全部失败 → 返回 "" 让调用方保留原 RemoteAddr
//
// 安全：ParseIP 校验是关键，否则攻击者可塞 "javascript:alert" 这类畸形字符串污染
// audit log（即使 RemoteAddr 是文本字段，下游 SplitHostPort 失败仍可能写入）。
func extractForwardedClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		first := strings.TrimSpace(strings.SplitN(xff, ",", 2)[0])
		if net.ParseIP(first) != nil {
			return first
		}
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		if net.ParseIP(xri) != nil {
			return xri
		}
	}
	return ""
}

// ParseTrustedProxiesEnv 解析 TRUSTED_PROXIES 环境变量（逗号分隔 CIDR 列表）。
//
// 例：
//
//	"127.0.0.1/32,::1/128"  → 同机 Caddy 反代
//	""                      → nil（直连模式 fail-safe）
//
// 设计取舍：
//   - 任一 CIDR 解析失败立刻 return error 让 main.go fail-fast，不静默丢弃
//   - 单个 IP 必须写成 /32 (IPv4) 或 /128 (IPv6) CIDR 形式，避免歧义
//   - trim 空白容忍 ".env 里写 "127.0.0.1/32, ::1/128"" 这种空格
func ParseTrustedProxiesEnv(s string) ([]net.IPNet, error) {
	if s == "" {
		return nil, nil
	}
	var nets []net.IPNet
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		_, n, err := net.ParseCIDR(part)
		if err != nil {
			return nil, err
		}
		nets = append(nets, *n)
	}
	return nets, nil
}
