/*
@file rbac.go
@description chi 兼容 RBAC 中间件，分两层职责：

  L1 LoadEffectivePermissions —— 每请求一次拉取 EffectivePermissionsService.Compute
                                  结果（3 段 code 列表），缓存到 request context；
                                  避免同一请求内多次权限检查重复打 DB。
  L2 RequirePermission(code)  —— chi middleware factory，从 ctx 取 perms 列表，
                                  按"四档匹配"判定 code 是否被授予；失败 403。

四档匹配（命中即放行）：
  1. *:*                        super_admin 哨兵
  2. <resource>:*:*             资源全开通
  3. <resource>:<action>:*      action 全 scope
  4. exact <resource>:<action>:<scope>

设计取舍：
  - 与旧 RequirePerm（基于 RBACService.HasPermission，2 段 code）并存：旧函数仍被
    feedback handler 等调用，本次 Task 8 只在新 perm 管理路由用 RequirePermission。
    handler 层逐步迁移由后续 task 完成。
  - 不在中间件内做 TTL 缓存：plan §"don't add caching beyond per-request context (TTL
    cache is YAGNI)"。每请求 1 次 DB 查询，p99 影响可忽略。
  - DB 错误返回 503 而非放行（fail-closed）：与 SuperAdminInvariants 的策略一致，
    任何不能验证权限的场景都拒绝服务，不允许"权限校验跳过"导致越权。
  - LoadEffectivePermissions 在没有 AuthContext 时静默放行：未鉴权请求由 RequireAuth
    （或 ogen SecurityHandler）拦截；本中间件不重复返 401。
  - MatchPermission 接受非 3 段的 code 也按 false 返回（防御性）；调用方应保证
    code 形如 "resource:action:scope"。

调用链（router 层期望顺序）：
  ogen SecurityHandler → AuthContext 注入 → LoadEffectivePermissions → SuperAdminInvariants
  → RequirePermission(code) → 业务 handler

@author Atlas.oi
@date 2026-05-02
*/

package middleware

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/ghostterm/progress-server/internal/services"
)

// effectivePermsCtxKey 私有类型作为 ctx key，避免外部包覆写。
type effectivePermsCtxKey struct{}

// LoadEffectivePermissions 返回 chi 中间件：每请求一次计算 effective perms 并写入 ctx。
//
// 业务流程：
//  1. 取 AuthContextFrom(r.Context())；缺失则放行（未鉴权场景由其它中间件兜）
//  2. 调 eff.Compute(ctx, ac.UserID)；DB 错误 → 503 + log
//  3. 把 perms []string 写入 ctx（key=effectivePermsCtxKey），下游 RequirePermission 取用
//
// 缓存策略：仅 request scope（context 生命周期 = 单次 HTTP 请求），不做跨请求 TTL。
func LoadEffectivePermissions(eff services.EffectivePermissionsService) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ac, ok := AuthContextFrom(r.Context())
			if !ok {
				// 未鉴权（如 /api/auth/login 走到这里）：放行，让 ogen SecurityHandler
				// 或 RequireAuth 决定是否拦截
				next.ServeHTTP(w, r)
				return
			}
			perms, err := eff.Compute(r.Context(), ac.UserID)
			if err != nil {
				// 服务层失败：明确暴露而非放行（first-principles：不允许 fallback 隐藏问题）
				log.Printf("rbac: load effective permissions failed for user %d: %v", ac.UserID, err)
				writeServiceUnavailable(w, "权限信息加载失败，请稍后重试")
				return
			}
			ctx := context.WithValue(r.Context(), effectivePermsCtxKey{}, perms)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// EffectivePermsFrom 从 ctx 取出 LoadEffectivePermissions 缓存的 perms 列表。
//
// 第二返回值 false 表示 ctx 中没有该值（未挂中间件 / 未鉴权请求）。
func EffectivePermsFrom(ctx context.Context) ([]string, bool) {
	v := ctx.Value(effectivePermsCtxKey{})
	if v == nil {
		return nil, false
	}
	perms, ok := v.([]string)
	return perms, ok
}

// WithEffectivePermissions 仅供测试使用：把 perms 列表写入 ctx，绕过中间件。
//
// 业务背景：单测 RequirePermission 时不想拉真实 DB 计算 effective perms，
// 直接构造 ctx → request 即可。
func WithEffectivePermissions(ctx context.Context, perms []string) context.Context {
	return context.WithValue(ctx, effectivePermsCtxKey{}, perms)
}

// RequirePermission 返回 chi 中间件 factory：校验 ctx 中 perms 是否覆盖 code。
//
// 必须在 LoadEffectivePermissions 之后挂载；否则 ctx 没有 perms → 403。
//
// 业务流程：
//  1. EffectivePermsFrom 取 perms；缺失 → 403（防御：避免"未挂载即放行"的隐式越权）
//  2. MatchPermission(perms, code) → 命中放行；不命中 → 403
//
// 注：本函数不调 AuthContextFrom；perms 列表本身已蕴含"已鉴权 + 已计算"语义。
func RequirePermission(code string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			perms, ok := EffectivePermsFrom(r.Context())
			if !ok {
				// 缺失说明 LoadEffectivePermissions 没跑到（未鉴权 / 配置错误）
				writePermissionDenied(w, "缺少权限信息")
				return
			}
			if !MatchPermission(perms, code) {
				writePermissionDenied(w, "无权访问该资源："+code)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// MatchPermission 按四档优先级判定 perms 是否授予 want。导出供 handler / 测试复用。
//
// 输入约束：want 必须形如 "resource:action:scope"；非法格式直接返 false。
// 性能：单次构 set 后 4 次 O(1) 查找；O(N+4) 与 N=len(perms) 线性。
func MatchPermission(perms []string, want string) bool {
	parts := strings.Split(want, ":")
	if len(parts) != 3 {
		return false
	}
	if parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return false
	}

	set := make(map[string]struct{}, len(perms))
	for _, p := range perms {
		set[p] = struct{}{}
	}

	// 1. super_admin 哨兵优先（最频繁场景，提前返回）
	if _, ok := set["*:*"]; ok {
		return true
	}
	// 2. exact match
	if _, ok := set[want]; ok {
		return true
	}
	// 3. resource:action:* （action 全 scope 通配）
	if _, ok := set[parts[0]+":"+parts[1]+":*"]; ok {
		return true
	}
	// 4. resource:*:* （资源全开通）
	if _, ok := set[parts[0]+":*:*"]; ok {
		return true
	}
	return false
}

// ============================================================
// Legacy RequirePerm（基于 RBACService.HasPermission，2 段 code）
//
// 业务背景：feedback handler 等仍在内部调 RBACService.HasPermission；
// 该 middleware 暂时保留以避免一刀切重构。Task 8 只把新 perm 管理 6 路由
// 切到 LoadEffectivePermissions+RequirePermission 链路；其它 handler 后续迁移。
// ============================================================

// RequirePerm 返回 chi middleware，校验当前 session 是否拥有 perm 权限。
//
// 业务流程：
//  1. 从 ctx 取 AuthContext（依赖前置 RequireAuth 中间件）
//  2. 调 svc.HasPermission；任何错误（DB 故障 / 缓存读取失败）一律 403，避免暴露内部
//  3. 无权限 → 403 + permission_denied envelope；有权限 → next.ServeHTTP
//
// 设计取舍：
//   - 不返回 401：未登录场景在 RequireAuth 已被拦下；进入本中间件 = 已登录
//   - 不区分"无 ctx" 与 "查询失败" 的状态码：都是 403，不暴露内部异常
//   - HasPermission DB 错误打日志（chi Logger 已注册）但不向用户暴露
func RequirePerm(svc services.RBACService, perm string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ac, ok := AuthContextFrom(r.Context())
			if !ok {
				// 没有 AuthContext = 没经过 RequireAuth；语义上是配置错误，但仍以 403 回
				writePermissionDenied(w, "缺少身份信息")
				return
			}
			ok, err := svc.HasPermission(r.Context(), ac.UserID, ac.RoleID, perm)
			if err != nil {
				// DB 故障兜底：拒绝放行 + 日志已由上游 chi.Logger 中间件记录
				writePermissionDenied(w, "权限校验失败")
				return
			}
			if !ok {
				writePermissionDenied(w, "无权访问该资源")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// writePermissionDenied 输出 403 + ErrorEnvelope JSON。
//
// envelope.error.code 固定为 "permission_denied"，与 OpenAPI 错误枚举对齐。
func writePermissionDenied(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	body := map[string]any{
		"error": map[string]any{
			"code":    "permission_denied",
			"message": msg,
		},
	}
	_ = json.NewEncoder(w).Encode(body)
}
