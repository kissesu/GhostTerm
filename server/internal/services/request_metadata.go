// @file request_metadata.go
// @description 单次请求的客户端审计 metadata（client IP / User-Agent）+ ctx 注入/取出 helper。
//
//	业务背景（用户原话 2026-05-03）：
//	    "需要在反馈、状态、创建 tag 右侧显示提交当前时间线的用户账号的功能,
//	     这样时间线信息才完整"
//	审计四件套之 ②③：clientIP + userAgent，与 actorUsername / dwellMs / attachmentCount 协同。
//
//	架构决策：
//	    - 类型 + helper 放在 services 包而非 middleware 包：
//	      middleware 包已 import services 包（用 AuthContext），反向依赖会环；
//	      services 是"业务核心 + 共享 ctx 类型"的合适宿主
//	    - middleware/metadata.go 仅做 *http.Request → services.RequestMetadata 提取
//	    - 缺失时 RequestMetadataFrom 返回零值结构 + false，调用方必须容错处理
//
// @author Atlas.oi
// @date 2026-05-03

package services

import "context"

// RequestMetadata 封装单次请求的客户端审计字段。
//
// ClientIP 是不带端口的 IP 字符串（"127.0.0.1" / "192.168.1.1" / "::1"）；
// 解析失败时为空串。空串在 SQL INSERT 时应翻译为 NULL（INET 类型不接受空串）。
//
// UserAgent 直接保存请求头原值。空串入库（TEXT 列允许）。
type RequestMetadata struct {
	ClientIP  string
	UserAgent string
}

// requestMetadataKey 是私有 ctx key（unexported struct{} 保证跨包不会冲突）。
type requestMetadataKey struct{}

// RequestMetadataFrom 从 ctx 取 RequestMetadata；不存在返回零值 + false。
//
// 业务用法：
//
//	md, _ := services.RequestMetadataFrom(ctx)
//	tx.Exec(ctx,
//	    `INSERT INTO feedbacks (..., client_ip, user_agent) VALUES (..., $N, $N+1)`,
//	    ..., NullableIP(md.ClientIP), md.UserAgent)
func RequestMetadataFrom(ctx context.Context) (RequestMetadata, bool) {
	v := ctx.Value(requestMetadataKey{})
	if v == nil {
		return RequestMetadata{}, false
	}
	md, ok := v.(RequestMetadata)
	return md, ok
}

// WithRequestMetadata 把 metadata 写入 ctx。中间件 + 测试都用这一条路径。
func WithRequestMetadata(ctx context.Context, md RequestMetadata) context.Context {
	return context.WithValue(ctx, requestMetadataKey{}, md)
}

// NullableIP 把空串 ClientIP 翻译为 *string nil 适配 PostgreSQL INET 列。
//
// PostgreSQL INET 类型在 INSERT 时若收到空串会报"invalid input syntax for type inet: """；
// pgx 把 nil interface 翻译为 SQL NULL 才合规。
//
// 用法：
//
//	tx.Exec(ctx, `INSERT ... client_ip ... VALUES ... $N`, ..., services.NullableIP(md.ClientIP))
func NullableIP(ip string) any {
	if ip == "" {
		return nil
	}
	return ip
}

// ============================================================
// AuthContext ctx 注入 / 读取 helper（finding #20 audit 需要在 service 层读 actor）
// ============================================================
//
// 业务背景：原本 AuthContext 的 ctx key 维护在 middleware 包内部（authCtxKey），
// 但 user_service / file_service 审计写入需要 actor 的 UserID / RoleID，
// 不能反向 import middleware（middleware 已 import services 单向依赖）。
// 解决：把 ctx key 移到 services 包，middleware 写入时调 services.WithAuthContext。
//
// 与 middleware.UserIDKey / RoleIDKey 的关系：那两个是单值便利 key 给 chi handler
// 直接读 user_id / role_id 用，仍保留在 middleware 包；本 key 是结构体级 AuthContext。

// authContextKey 是私有 ctx key 类型。unexported struct{} 保证跨包零冲突。
type authContextKey struct{}

// AuthContextFrom 从 ctx 取出 AuthContext；不存在返回零值 + false。
//
// 业务用法：
//
//	if ac, ok := services.AuthContextFrom(ctx); ok {
//	    audit.Log(ctx, AuditEvent{UserID: &ac.UserID, ...})
//	}
func AuthContextFrom(ctx context.Context) (AuthContext, bool) {
	v := ctx.Value(authContextKey{})
	if v == nil {
		return AuthContext{}, false
	}
	ac, ok := v.(AuthContext)
	return ac, ok
}

// WithAuthContext 把 AuthContext 写入 ctx；中间件 + 测试统一调用此函数。
//
// middleware.WithAuthContext 内部 forward 调用本函数 + 自己再写
// UserIDKey / RoleIDKey 两个便利 key（兼容现有 chi handler 调用）。
func WithAuthContext(ctx context.Context, ac AuthContext) context.Context {
	return context.WithValue(ctx, authContextKey{}, ac)
}
