/*
@file publicip.go
@description Server 端公网 IP 获取（go 标准库 http.Get ipify）+ 进程内缓存。

	业务背景（用户反馈 2026-05-03）："需要公网IP而不是局域网IP"
	GhostTerm 桌面应用 = 本机 progress-server，server 进程的公网 IP 等价于
	用户机器的公网 IP。让 server 启动后异步调一次 ipify 缓存 30 分钟，
	middleware 在 r.RemoteAddr 是 loopback 时优先返回 cached publicIp。

	设计取舍：
	  - 用 Go 标准库 http.Get + json.Unmarshal，不引第三方依赖
	  - 30 分钟 TTL 平衡新鲜度（DHCP 公网 IP 偶尔变）与外部调用次数
	  - 失败兜底回 RemoteAddr，不阻断业务请求
	  - sync.Mutex 保护 cache 读写；单飞 fetch 用 inflight 标记
	  - 调用 ipify 设 5s timeout，server 启动慢网络下不卡死

@author Atlas.oi
@date 2026-05-03
*/

package middleware

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"
)

const (
	publicIpTTL          = 30 * time.Minute
	publicIpFetchTimeout = 5 * time.Second
	publicIpServiceURL   = "https://api.ipify.org?format=json"
)

type publicIpCache struct {
	mu       sync.Mutex
	ip       string
	at       time.Time
	inflight bool
}

var pubIp = &publicIpCache{}

// PublicIP 同步返回当前缓存的公网 IP；缓存空或过期时触发后台 fetch 并返回空串。
//
// 调用方（middleware extractClientIP）应该 if pub := PublicIP(); pub != "" 用之，
// 否则 fallback RemoteAddr。首次调用一定返回空串（fetch 异步），第二次起按缓存。
func PublicIP() string {
	pubIp.mu.Lock()
	if pubIp.ip != "" && time.Since(pubIp.at) < publicIpTTL {
		ip := pubIp.ip
		pubIp.mu.Unlock()
		return ip
	}
	if !pubIp.inflight {
		pubIp.inflight = true
		go fetchPublicIPAsync()
	}
	pubIp.mu.Unlock()
	return ""
}

// fetchPublicIPAsync 后台调 ipify 写缓存。失败时不写缓存（保留旧值供 TTL 内继续返回）。
func fetchPublicIPAsync() {
	defer func() {
		pubIp.mu.Lock()
		pubIp.inflight = false
		pubIp.mu.Unlock()
	}()

	ctx, cancel := context.WithTimeout(context.Background(), publicIpFetchTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, publicIpServiceURL, nil)
	if err != nil {
		return
	}
	req.Header.Set("Accept", "application/json")

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return
	}

	var body struct {
		IP string `json:"ip"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return
	}
	if body.IP == "" {
		return
	}

	pubIp.mu.Lock()
	pubIp.ip = body.IP
	pubIp.at = time.Now()
	pubIp.mu.Unlock()
}

// PrimePublicIP 在 server 启动时调用，立即触发后台 fetch 让首次请求即可拿到缓存。
// 不阻塞调用方。
func PrimePublicIP() {
	pubIp.mu.Lock()
	if !pubIp.inflight {
		pubIp.inflight = true
		go fetchPublicIPAsync()
	}
	pubIp.mu.Unlock()
}
