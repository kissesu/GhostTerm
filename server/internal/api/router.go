/*
@file router.go
@description chi 路由 + ogen 生成的 OpenAPI server 装载入口；handler 为占位实现，
             所有 endpoint 返回 not_implemented_yet error（v2 part3 §AB1：禁止 panic）。
             后续 Phase 1-13 由各 worker 替换 oasHandler 内具体方法。
@author Atlas.oi
@date 2026-04-29
*/

package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/ghostterm/progress-server/internal/api/oas"
)

// ErrNotImplementedYet 是 Phase 0a skeleton 阶段所有未实现 endpoint 的统一错误。
//
// 业务背景：
// 1. v2 part3 §AB1 明确要求：router skeleton 不允许 panic("TODO")，必须返回明确错误码
// 2. ogen 框架会把这个 error 透传给 SecurityHandler/Operation 失败链路，
//    在 main.go 的 ErrorHandler 中映射为 501 Not Implemented + ErrorEnvelope
// 3. 当某个 endpoint 在 Phase 4-12 被真实实现后，oasHandler 的对应 method 会被覆盖
var ErrNotImplementedYet = errors.New("not_implemented_yet")

// oasHandler 是 oas.Handler 接口的项目级实现。
//
// 通过嵌入 oas.UnimplementedHandler 自动获取所有方法的 not-implemented 默认实现
// （ogen 生成的 UnimplementedHandler 每个方法返回 http.ErrNotImplemented）。
//
// 后续 phase 的 worker 会在本 struct 上添加具体业务字段（service 引用）并覆盖对应方法。
// 这里不预设具体 service field，避免 Phase 1-3 引入循环依赖；service 注入在各 phase 自行接入。
type oasHandler struct {
	oas.UnimplementedHandler
}

// 编译时校验：oasHandler 必须满足 oas.Handler 接口
var _ oas.Handler = (*oasHandler)(nil)

// oasSecurityHandler 是 oas.SecurityHandler 接口的占位实现。
//
// 业务背景：
// - OpenAPI 全局声明了 bearerAuth，ogen 要求必须提供 SecurityHandler
// - Phase 0a 阶段尚未接入 JWT，统一返回 not_implemented_yet
// - Phase 2（Auth）会用真实 JWT 解析逻辑替换本 struct
type oasSecurityHandler struct{}

// HandleBearerAuth 占位实现：拒绝所有需要鉴权的请求。
//
// 安全考量：默认 deny 而非 allow，符合"零信任"原则，
// 即使 Phase 2 未及时实现，也不会出现接口被无鉴权访问的安全空窗。
func (oasSecurityHandler) HandleBearerAuth(ctx context.Context, op oas.OperationName, t oas.BearerAuth) (context.Context, error) {
	return ctx, ErrNotImplementedYet
}

// 编译时校验
var _ oas.SecurityHandler = (*oasSecurityHandler)(nil)

// NewRouter 装配 chi 基础中间件 + ogen 生成的 OpenAPI server，返回可挂载的 http.Handler。
//
// 业务流程：
// 1. 创建 chi router，注册 RequestID / Logger / Recoverer 三类基础中间件
// 2. 暴露 /healthz 健康检查（main.go 的 server skeleton 验证用，不在 OpenAPI 契约中）
// 3. 用 ogen 生成的 oas.NewServer 包装 oasHandler + oasSecurityHandler，
//    挂载在根路径 "/"（OpenAPI 中所有 path 已含 /api 前缀，不需要再 Mount("/api", ...)）
//
// 错误处理：
// - ogen 默认 ErrorHandler 把 handler 返回的 error 转成 500，未来 Phase 1-2 会替换为
//   ErrorEnvelope 序列化中间件，把 ErrNotImplementedYet 等映射为对应 HTTP 状态码
func NewRouter() (http.Handler, error) {
	r := chi.NewRouter()

	// chi 基础中间件
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	// healthz 用于 docker/systemd 探活
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	// 装配 ogen 生成的 server
	oasServer, err := oas.NewServer(&oasHandler{}, oasSecurityHandler{})
	if err != nil {
		return nil, err
	}

	// 把 ogen server 挂在根路径，OpenAPI 中所有 path 已含 /api 前缀
	r.Mount("/", oasServer)

	return r, nil
}
