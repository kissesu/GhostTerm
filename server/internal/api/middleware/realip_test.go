/*
@file realip_test.go
@description TrustedProxyRealIP middleware 测试。验证仅当 RemoteAddr 在 trusted CIDR
             白名单内才信任 X-Forwarded-For/X-Real-IP；空 trusted = 拒绝任何代理头
             （fail-safe 直连模式审计 IP 不可被伪造）。

             业务背景（v2 安全审计 finding #10）：
                 chimw.RealIP 无条件信任 X-Forwarded-For，攻击者直连 8080 端口带
                 X-Forwarded-For: 1.2.3.4 即可伪造 8 张审计表的 client_ip。
                 新部署模式（103.236.85.144:38080 + Caddy 自签）应仅信任 Caddy 反代，
                 直连模式下完全不信任代理头。

@author Atlas.oi
@date 2026-05-08
*/

package middleware_test

import (
	"net"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/ghostterm/progress-server/internal/api/middleware"
)

// mustCIDR 解析 CIDR 字符串并返回 *net.IPNet；解析失败立刻 fail，避免测试用例里
// 重复写 require.NoError。
func mustCIDR(t *testing.T, s string) net.IPNet {
	t.Helper()
	_, n, err := net.ParseCIDR(s)
	require.NoError(t, err)
	return *n
}

// captureIPHandler 把 RemoteAddr 写到响应头供测试断言：避免引入 testify mock，
// 用 header roundtrip 简单稳定。
func captureIPHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Captured-RemoteAddr", r.RemoteAddr)
		w.WriteHeader(http.StatusOK)
	})
}

// TestTrustedProxyRealIP_RejectsUntrustedXFF 验证不在 trusted CIDR 内的请求带 XFF
// 时 RemoteAddr 不被改写，避免攻击者直连 8080 伪造 audit IP。
func TestTrustedProxyRealIP_RejectsUntrustedXFF(t *testing.T) {
	mw := middleware.TrustedProxyRealIP([]net.IPNet{mustCIDR(t, "127.0.0.1/32")})
	handler := mw(captureIPHandler())

	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "8.8.8.8:5678"
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	require.Equal(t, "8.8.8.8:5678", rec.Header().Get("X-Captured-RemoteAddr"))
}

// TestTrustedProxyRealIP_AcceptsTrustedXFF 验证来自 trusted CIDR（如 Caddy 同机
// 反代 127.0.0.1）的请求 XFF 被采纳。
func TestTrustedProxyRealIP_AcceptsTrustedXFF(t *testing.T) {
	mw := middleware.TrustedProxyRealIP([]net.IPNet{mustCIDR(t, "127.0.0.1/32")})
	handler := mw(captureIPHandler())

	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "127.0.0.1:5678"
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	require.Equal(t, "1.2.3.4", rec.Header().Get("X-Captured-RemoteAddr"))
}

// TestTrustedProxyRealIP_TakesLeftmostXFF 验证多级反代场景下 XFF 取最左侧（最接近
// client）IP。"1.2.3.4, 5.6.7.8" 中 1.2.3.4 是真实 client。
func TestTrustedProxyRealIP_TakesLeftmostXFF(t *testing.T) {
	mw := middleware.TrustedProxyRealIP([]net.IPNet{mustCIDR(t, "127.0.0.1/32")})
	handler := mw(captureIPHandler())

	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "127.0.0.1:5678"
	req.Header.Set("X-Forwarded-For", "1.2.3.4, 5.6.7.8, 9.9.9.9")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	require.Equal(t, "1.2.3.4", rec.Header().Get("X-Captured-RemoteAddr"))
}

// TestTrustedProxyRealIP_FallbackToXRealIP 验证无 XFF 时 fallback X-Real-IP。
// nginx-style 反代默认设 X-Real-IP 而非 XFF 的部署也要兼容。
func TestTrustedProxyRealIP_FallbackToXRealIP(t *testing.T) {
	mw := middleware.TrustedProxyRealIP([]net.IPNet{mustCIDR(t, "127.0.0.1/32")})
	handler := mw(captureIPHandler())

	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "127.0.0.1:5678"
	req.Header.Set("X-Real-IP", "10.20.30.40")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	require.Equal(t, "10.20.30.40", rec.Header().Get("X-Captured-RemoteAddr"))
}

// TestTrustedProxyRealIP_EmptyTrustedRefusesAllXFF 验证 trusted=nil 时即使来自
// 127.0.0.1 也不信任代理头（直连模式 fail-safe），audit IP 不可被任何调用方伪造。
func TestTrustedProxyRealIP_EmptyTrustedRefusesAllXFF(t *testing.T) {
	mw := middleware.TrustedProxyRealIP(nil)
	handler := mw(captureIPHandler())

	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "127.0.0.1:5678"
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	require.Equal(t, "127.0.0.1:5678", rec.Header().Get("X-Captured-RemoteAddr"))
}

// TestTrustedProxyRealIP_InvalidXFFValueIgnored 验证 XFF 携带非 IP 字符串（如
// "not-an-ip"）时 fail-safe 保留原 RemoteAddr，不让攻击者通过塞畸形字符串污染审计。
func TestTrustedProxyRealIP_InvalidXFFValueIgnored(t *testing.T) {
	mw := middleware.TrustedProxyRealIP([]net.IPNet{mustCIDR(t, "127.0.0.1/32")})
	handler := mw(captureIPHandler())

	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "127.0.0.1:5678"
	req.Header.Set("X-Forwarded-For", "not-an-ip")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	require.Equal(t, "127.0.0.1:5678", rec.Header().Get("X-Captured-RemoteAddr"))
}
