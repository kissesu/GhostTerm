/*
@file rbac.go
@description chi 兼容的 RequirePerm 中间件：检查 ctx 中已注入的 AuthContext 对应角色
             是否拥有指定权限码 perm。失败返回 403 + permission_denied envelope。

             调用链路：
               RequireAuth (Phase 2) → 注入 AuthContext
                                     → RequirePerm("project:create") 校验
                                     → 业务 handler

             v2 part1 §C2 设计：
             - 数据行可见性由 RLS 处理（RequireAuth 后 handler 在事务内 SetSessionContext 即可）
             - 端点级权限由本中间件处理（"能不能调这个 endpoint"）
             - 两者正交：能调 endpoint 不代表能看到所有行，能看到行不代表能调操作 endpoint
@author Atlas.oi
@date 2026-04-29
*/

package middleware

import (
	"encoding/json"
	"net/http"

	"github.com/ghostterm/progress-server/internal/services"
)

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
