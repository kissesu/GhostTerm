/*
@file ratelimit.go
@description 登录与 refresh 端点速率限制 middleware。
             用 golang.org/x/time/rate 令牌桶按 IP 与 username 双维度封顶，
             返 429 + Retry-After，并自动 GC 长期未活跃的桶防内存泄露。

             业务背景（v2 安全审计 finding #7）：5 人自用环境 username 高度可枚举
             （admin/dev1/cs1），公网 8080 任意人可无限调 /api/auth/login。
             bcrypt cost 12 单核 ~250-400ms 仍可被分布式 botnet 暴破，必须在
             鉴权之前就在 transport 层挡住。
@author Atlas.oi
@date 2026-05-08
*/

package middleware

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// RateLimitConfig 速率限制配置。
//
// 默认建议（生产）：
//   - LoginPerMinPerIP=5：单 IP 每分钟最多 5 次登录尝试，防 botnet 暴破
//   - LoginPerMinPerUser=10：单 username 每分钟最多 10 次（多 IP 联合也算同一桶），
//     防"分布式低速撞库"绕过 IP 维度
//   - RefreshPerMinPerIP=30：refresh 频次更高（前端临过期 silent refresh），
//     30/min 给 access token 较短 TTL 留足空间
//   - TTL=10m：桶过期清理周期；既不让突发流量被清掉，也不让"久不活跃 IP"
//     长期占内存
type RateLimitConfig struct {
	LoginPerMinPerIP   int
	LoginPerMinPerUser int
	RefreshPerMinPerIP int
	TTL                time.Duration
}

// bucketEntry 持有一个 rate.Limiter 与最近一次 Allow 时间，供 GC 决定是否回收。
type bucketEntry struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// LoginRateLimiter 三组独立桶 map：login-IP / login-user / refresh-IP。
//
// 设计取舍：
//   - 不用 Redis：5 人自用单实例部署，进程内 map + sync.Mutex 已足；上 Redis
//     反而引入分布式协议复杂度且测试更难。多实例水平扩容时再切。
//   - 不复用同一组桶：login 与 refresh 限速值不同，混用会让 refresh 被 login 抢占。
//   - lastSeen 写在 getOrCreate 而不在 Allow 后：取桶就算"有人来访问"，避免
//     "桶被取出但 Allow 失败"导致 lastSeen 不刷新被 GC 误删。
type LoginRateLimiter struct {
	cfg RateLimitConfig

	ipMu      sync.Mutex
	ipBuckets map[string]*bucketEntry

	userMu      sync.Mutex
	userBuckets map[string]*bucketEntry

	refreshMu      sync.Mutex
	refreshBuckets map[string]*bucketEntry

	stopCh chan struct{}
}

// NewLoginRateLimiter 构造器：启动后台 GC goroutine 周期清理过期桶。
func NewLoginRateLimiter(cfg RateLimitConfig) *LoginRateLimiter {
	rl := &LoginRateLimiter{
		cfg:            cfg,
		ipBuckets:      make(map[string]*bucketEntry),
		userBuckets:    make(map[string]*bucketEntry),
		refreshBuckets: make(map[string]*bucketEntry),
		stopCh:         make(chan struct{}),
	}
	go rl.gcLoop()
	return rl
}

// Stop 停止后台 GC goroutine。
//
// 生产环境 Limiter 与 server 同生命周期不需调用；测试 t.Cleanup 调用避免 leak。
func (rl *LoginRateLimiter) Stop() {
	close(rl.stopCh)
}

// gcLoop 周期触发 gc，直到 Stop 被调。
func (rl *LoginRateLimiter) gcLoop() {
	t := time.NewTicker(rl.cfg.TTL)
	defer t.Stop()
	for {
		select {
		case <-rl.stopCh:
			return
		case <-t.C:
			rl.gc()
		}
	}
}

// gc 删除 lastSeen 早于 cutoff 的桶。
//
// cutoff = now - TTL：保证桶在 TTL 周期内至少看见一次活动才保留。
func (rl *LoginRateLimiter) gc() {
	cutoff := time.Now().Add(-rl.cfg.TTL)
	for _, set := range []struct {
		mu *sync.Mutex
		m  map[string]*bucketEntry
	}{
		{&rl.ipMu, rl.ipBuckets},
		{&rl.userMu, rl.userBuckets},
		{&rl.refreshMu, rl.refreshBuckets},
	} {
		set.mu.Lock()
		for k, e := range set.m {
			if e.lastSeen.Before(cutoff) {
				delete(set.m, k)
			}
		}
		set.mu.Unlock()
	}
}

// getOrCreateBucket 取或新建一个桶，并刷新 lastSeen。
//
// 速率换算：rate.Every(time.Minute/perMin) 让 token 平均 (60/perMin) 秒补一个；
// burst=perMin 让初始即可一次发完一分钟配额（避免冷启动第一秒被卡住）。
func (rl *LoginRateLimiter) getOrCreateBucket(mu *sync.Mutex, m map[string]*bucketEntry, key string, perMin int) *rate.Limiter {
	mu.Lock()
	defer mu.Unlock()
	e, ok := m[key]
	if !ok {
		e = &bucketEntry{
			limiter: rate.NewLimiter(rate.Every(time.Minute/time.Duration(perMin)), perMin),
		}
		m[key] = e
	}
	e.lastSeen = time.Now()
	return e.limiter
}

// clientIP 从 r.RemoteAddr 取出 host 部分；若无端口直接返回原值。
//
// 注：上游 chi RealIP middleware 已根据 X-Forwarded-For 改写 RemoteAddr，
// 所以这里直接用 RemoteAddr 即可拿到真实客户端 IP（生产 Caddy 反代场景）。
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// extractUsername 从 login body 提取 username（小写、trim）。
//
// 关键：必须 restore r.Body 让下游 ogen decoder 能再读一次（不然会拿到空 body 报 400）。
// 用 io.NopCloser + strings.NewReader 包装回去；上限 4096 字节防巨包消耗内存。
//
// 解析失败（无 body / 非 JSON / 缺字段）返回空字符串，让上游跳过 user 维度限速。
// 这是 fail-open 策略：限速失败不该让正常登录请求被拒，IP 维度仍兜底防暴破。
func extractUsername(r *http.Request) string {
	if r.Body == nil {
		return ""
	}
	bodyBytes, err := io.ReadAll(http.MaxBytesReader(nil, r.Body, 4096))
	if err != nil {
		return ""
	}
	r.Body = io.NopCloser(strings.NewReader(string(bodyBytes)))
	var payload struct {
		Username string `json:"username"`
	}
	_ = json.Unmarshal(bodyBytes, &payload)
	return strings.ToLower(strings.TrimSpace(payload.Username))
}

// rateLimitErrorBody 是 429 的 ErrorEnvelope JSON。
//
// code 与 ErrorEnvelope 协议保持兼容：前端 fetch 拦截层按 code=rate_limited 提示用户。
const rateLimitErrorBody = `{"error":{"code":"rate_limited","message":"请求过于频繁，请稍后再试"}}`

// writeRateLimit 写 429 响应：固定 60 秒 Retry-After + JSON body。
func writeRateLimit(w http.ResponseWriter) {
	w.Header().Set("Retry-After", "60")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusTooManyRequests)
	_, _ = w.Write([]byte(rateLimitErrorBody))
}

// LoginMiddleware 登录端点速率限制：IP + username 双维度。
//
// 业务流程：
//  1. 先查 IP 桶（清廉客户端的快速路径）
//  2. peek body 拿 username（必须 restore body 让 next handler 可读）
//  3. 查 username 桶（防多 IP 撞同一账号）
//  4. 任一桶 Allow 失败 → 429 + Retry-After
//
// 设计取舍：先 IP 后 user 顺序——IP 维度命中即直接拒，避免恶意客户端用花式 username
// 触发反复 JSON 解析浪费 CPU。
func (rl *LoginRateLimiter) LoginMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		ipBucket := rl.getOrCreateBucket(&rl.ipMu, rl.ipBuckets, ip, rl.cfg.LoginPerMinPerIP)
		if !ipBucket.Allow() {
			writeRateLimit(w)
			return
		}
		username := extractUsername(r)
		if username != "" {
			userBucket := rl.getOrCreateBucket(&rl.userMu, rl.userBuckets, username, rl.cfg.LoginPerMinPerUser)
			if !userBucket.Allow() {
				writeRateLimit(w)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// RefreshMiddleware refresh 端点速率限制：仅 IP 维度。
//
// refresh body 是 opaque token 不含可识别身份，所以无 user 维度。仅 IP 兜底足够：
// refresh 接口本身已有 token rotation + token_version 防重放，限速主要防 DoS。
func (rl *LoginRateLimiter) RefreshMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		bucket := rl.getOrCreateBucket(&rl.refreshMu, rl.refreshBuckets, ip, rl.cfg.RefreshPerMinPerIP)
		if !bucket.Allow() {
			writeRateLimit(w)
			return
		}
		next.ServeHTTP(w, r)
	})
}
