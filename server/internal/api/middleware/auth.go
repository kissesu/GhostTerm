/*
@file auth.go
@description chi 鉴权中间件：
             - 从 Authorization: Bearer <token> 解析 access token
             - 调 services.AuthService.VerifyAccessToken（含签名 + token_version + is_active 校验）
             - 注入 AuthContext 到 request.Context()
             - 失败统一返回 401 + ErrorEnvelope { code: "unauthorized" }

             RLS GUC 注入策略（v2 part2 §W11+）：
             - pgxpool 每条 query 可能拿不同连接；中间件级别 SET LOCAL 不可靠
             - 改为：handler 在事务内 SET LOCAL app.user_id / app.role_id（与业务 SQL 同事务）
             - 本中间件只负责"身份解析+注入 ctx"，不动 DB 连接
@author Atlas.oi
@date 2026-04-29
*/

package middleware

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/ghostterm/progress-server/internal/services"
)

// ctxKey 是一个独立的私有类型，避免 context.Value 的 key 与其它包冲突。
//
// Go 标准库推荐：context.WithValue 的 key 必须是 unexported 自定义类型，
// 这样外部包想访问也只能通过本包暴露的 helper（如 AuthContextFrom）。
type ctxKey int

const (
	// authCtxKey 存放 services.AuthContext（含 UserID / RoleID）
	authCtxKey ctxKey = iota
)

// UserIDKey / RoleIDKey 是给业务代码读取上下文身份的辅助 key。
//
// 业务背景：本项目目前仅 AuthContext 一种身份类型，但留出独立 key 便于
// 后续抽到 RBAC service 后业务侧只关心 user_id / role_id 两个原子值。
type userIDKey struct{}
type roleIDKey struct{}

var (
	UserIDKey = userIDKey{}
	RoleIDKey = roleIDKey{}
)

// RequireAuth 返回一个 chi 兼容的 middleware：必须携带合法 Bearer token 才能放行。
//
// 业务流程：
//  1. 读 Authorization header；缺失 / 非 Bearer 前缀 → 401
//  2. 调 svc.VerifyAccessToken：签名 + iss + exp + token_version + is_active
//  3. 把返回的 services.AuthContext 写入 ctx，下游 handler 用 AuthContextFrom 取
//
// 安全考量：
//   - 401 响应体 schema 与业务 ErrorEnvelope 完全一致，前端 catch 时不用区分来源
//   - 不暴露具体失败原因（"token expired" / "version mismatch"）—— 一律提示"未登录或会话已失效"
//     避免攻击者通过响应文案推断 server 行为
func RequireAuth(svc services.AuthService) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw := bearerTokenFrom(r)
			if raw == "" {
				writeUnauthorized(w, "未登录或会话已失效")
				return
			}
			sc, err := svc.VerifyAccessToken(r.Context(), raw)
			if err != nil {
				writeUnauthorized(w, "未登录或会话已失效")
				return
			}
			ac, ok := sc.(services.AuthContext)
			if !ok {
				writeUnauthorized(w, "未登录或会话已失效")
				return
			}

			// 注入到 ctx：单一 AuthContext key + 两个独立 user_id/role_id key（双重便利）
			ctx := context.WithValue(r.Context(), authCtxKey, ac)
			ctx = context.WithValue(ctx, UserIDKey, ac.UserID)
			ctx = context.WithValue(ctx, RoleIDKey, ac.RoleID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// AuthContextFrom 从 ctx 取出 AuthContext；handler 入口必备。
func AuthContextFrom(ctx context.Context) (services.AuthContext, bool) {
	v := ctx.Value(authCtxKey)
	if v == nil {
		return services.AuthContext{}, false
	}
	ac, ok := v.(services.AuthContext)
	return ac, ok
}

// WithAuthContext 仅供测试 / 内部使用：把 AuthContext 写入 ctx。
//
// 业务背景：集成测试想直接调 handler 而绕过中间件时用本函数构造 ctx。
func WithAuthContext(ctx context.Context, ac services.AuthContext) context.Context {
	ctx = context.WithValue(ctx, authCtxKey, ac)
	ctx = context.WithValue(ctx, UserIDKey, ac.UserID)
	ctx = context.WithValue(ctx, RoleIDKey, ac.RoleID)
	return ctx
}

// bearerTokenFrom 抠出 "Authorization: Bearer xxx" 的 token；不匹配返回空串。
func bearerTokenFrom(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if h == "" {
		return ""
	}
	const prefix = "Bearer "
	if len(h) <= len(prefix) || !strings.EqualFold(h[:len(prefix)], prefix) {
		return ""
	}
	return strings.TrimSpace(h[len(prefix):])
}

// writeUnauthorized 输出 401 + ErrorEnvelope JSON。
func writeUnauthorized(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	body := map[string]any{
		"error": map[string]any{
			"code":    "unauthorized",
			"message": msg,
		},
	}
	_ = json.NewEncoder(w).Encode(body)
}
