/*
@file ws_test.go
@description WS handler 单测：CheckOrigin 严格白名单回归测试（finding #15）。
             覆盖 6 类典型场景：精确 localhost / 127.0.0.1 / tauri.localhost 接受；
             前缀绕过 (localhost.evil.com) / 外部 host / 空 Origin 拒绝。

业务背景：旧版 strings.HasPrefix(origin, "http://localhost") 可被
http://localhost.evil.com 绕过——攻击者注册该 DNS 即可让任意浏览器
帮助发起 WebSocket 升级请求并接收单向推送。

@author Atlas.oi
@date 2026-05-08
*/

package handlers_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/ghostterm/progress-server/internal/api/handlers"
)

// helper：构造一个带 Origin 头的请求
func wsReqWithOrigin(origin string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/api/ws/notifications", nil)
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	return req
}

func TestWSCheckOrigin_AcceptsExactLocalhost(t *testing.T) {
	for _, origin := range []string{
		"http://localhost",
		"http://localhost:1420",
		"http://localhost:5173",
		"https://localhost:3000",
	} {
		t.Run(origin, func(t *testing.T) {
			assert.True(t, handlers.WSCheckOrigin(wsReqWithOrigin(origin)),
				"标准 localhost origin 必须接受")
		})
	}
}

func TestWSCheckOrigin_AcceptsTauriLocalhost(t *testing.T) {
	// Tauri WKWebView 默认 origin
	assert.True(t, handlers.WSCheckOrigin(wsReqWithOrigin("tauri://localhost")))
	// Tauri Windows custom scheme（http://tauri.localhost）
	assert.True(t, handlers.WSCheckOrigin(wsReqWithOrigin("http://tauri.localhost")))
}

func TestWSCheckOrigin_AcceptsLoopback(t *testing.T) {
	for _, origin := range []string{
		"http://127.0.0.1",
		"http://127.0.0.1:1420",
		"https://127.0.0.1:3000",
	} {
		t.Run(origin, func(t *testing.T) {
			assert.True(t, handlers.WSCheckOrigin(wsReqWithOrigin(origin)))
		})
	}
}

// TestWSCheckOrigin_RejectsLocalhostSubdomainBypass 是核心安全用例：
// 旧版 strings.HasPrefix("http://localhost") 会把这些当合法 origin 放行。
func TestWSCheckOrigin_RejectsLocalhostSubdomainBypass(t *testing.T) {
	for _, origin := range []string{
		"http://localhost.evil.com",
		"http://localhost.evil.com:8080",
		"http://localhost-evil.com",
		"http://127.0.0.1.evil.com", // IP 后缀绕过
		"http://tauri.localhost.evil.com",
	} {
		t.Run(origin, func(t *testing.T) {
			assert.False(t, handlers.WSCheckOrigin(wsReqWithOrigin(origin)),
				"前缀绕过尝试 %q 必须被拒", origin)
		})
	}
}

func TestWSCheckOrigin_RejectsExternalHost(t *testing.T) {
	for _, origin := range []string{
		"https://evil.com",
		"http://attacker.example",
		"https://google.com",
	} {
		t.Run(origin, func(t *testing.T) {
			assert.False(t, handlers.WSCheckOrigin(wsReqWithOrigin(origin)))
		})
	}
}

// TestWSCheckOrigin_RejectsUnsafeScheme 验证 review L4：
// hostname 即使在白名单内，scheme 不在 allowedWSSchemes 也必须拒。
//
// 攻击不可达（浏览器 enforce Origin 头），但 defense-in-depth：
// 未来浏览器引入新 scheme 或 url.Parse 行为变化时本检查能堵漏。
func TestWSCheckOrigin_RejectsUnsafeScheme(t *testing.T) {
	for _, origin := range []string{
		"file://localhost",
		"file://localhost/path",
		"gopher://localhost",
		"javascript://localhost", // url.Parse 接受但不应放行
		"data://localhost",
	} {
		t.Run(origin, func(t *testing.T) {
			assert.False(t, handlers.WSCheckOrigin(wsReqWithOrigin(origin)),
				"hostname=localhost 但 scheme=%q 必须拒（L4 scheme 白名单）", origin)
		})
	}
}

func TestWSCheckOrigin_RejectsEmptyOrigin(t *testing.T) {
	// 空 Origin 头：旧版放行，新版严格拒
	// 真实客户端（Tauri / vite / 浏览器）都会发 Origin 头，空 Origin
	// 通常是 curl --raw 或脚本攻击；不再放行
	req := httptest.NewRequest(http.MethodGet, "/api/ws/notifications", nil)
	assert.False(t, handlers.WSCheckOrigin(req))
}

func TestWSCheckOrigin_RejectsMalformedOrigin(t *testing.T) {
	// url.Parse 在 Go 标准库容错性较高，绝大多数字符串都能 parse 成功；
	// 这里测一个会触发 url.Parse 错误的极端值（含控制字符）
	req := httptest.NewRequest(http.MethodGet, "/api/ws/notifications", nil)
	req.Header.Set("Origin", "http://\x7f.localhost") // DEL 字符让 url.Parse 失败
	assert.False(t, handlers.WSCheckOrigin(req))
}
