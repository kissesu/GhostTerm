/*
@file rbac.go
@description chi 兼容 RBAC 权限工具集 —— 仅暴露"context 读写 + 匹配"3 个原子函数：

  EffectivePermsFrom(ctx)           —— 取出已注入的 perms 列表
  WithEffectivePermissions(ctx, ps) —— 写入 perms 列表到 ctx（生产由 oasSecurityHandler
                                       调用、测试也可直接调）
  MatchPermission(perms, want)      —— 四档优先级匹配 *:* > exact > a:b:* > a:*:*

四档匹配（命中即放行）：
  1. *:*                        super_admin 哨兵
  2. <resource>:*:*             资源全开通
  3. <resource>:<action>:*      action 全 scope
  4. exact <resource>:<action>:<scope>

设计取舍：
  - 历史 LoadEffectivePermissions / RequirePermission chi middleware factory 已删除：
    所有路由走 ogen，由 oasSecurityHandler 在鉴权同时调 EffectivePermissionsService.Compute
    并 WithEffectivePermissions 注入 ctx；handler 内通过 EffectivePermsFrom +
    MatchPermission 自行判权。chi middleware 永无机会拦截 ogen 路由 → 死代码删之。
    （review §I1：架构上单一 source of truth；2026-05-02 移除）
  - 与旧 RequirePerm（基于 RBACService.HasPermission，2 段 code）并存：旧函数仍被
    feedback handler 等调用，逐步迁移由后续 task 完成。
  - MatchPermission 接受非 3 段的 code 也按 false 返回（防御性）；调用方应保证
    code 形如 "resource:action:scope"。

@author Atlas.oi
@date 2026-05-02
*/

package middleware

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/ghostterm/progress-server/internal/services"
)

// effectivePermsCtxKey 私有类型作为 ctx key，避免外部包覆写。
type effectivePermsCtxKey struct{}

// EffectivePermsFrom 从 ctx 取出 oasSecurityHandler（生产）或测试代码注入的 perms 列表。
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

// WithEffectivePermissions 把 perms 列表写入 ctx。
//
// 调用方：
//  - 生产：oasSecurityHandler 在 HandleBearerAuth 校验 token 后调 eff.Compute，把结果
//    写入 ctx；下游 handler 通过 EffectivePermsFrom 读取，0 次 DB 查询完成判权。
//  - 测试：单测 handler 时不想拉真实 DB 计算 effective perms，直接构造 ctx → request 即可。
func WithEffectivePermissions(ctx context.Context, perms []string) context.Context {
	return context.WithValue(ctx, effectivePermsCtxKey{}, perms)
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
