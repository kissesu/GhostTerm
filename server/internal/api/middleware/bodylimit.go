/*
@file bodylimit.go
@description HTTP body 大小限制 middleware（v2 安全审计 finding #14）。
             用 http.MaxBytesReader 把 r.Body 包成限长 reader，超限读取时返
             *http.MaxBytesError；handler 内 ReadAll/Decode/ParseMultipartForm 等
             调用会拿到该错误，通过 ogen 错误处理链路映射为 413 Payload Too Large。

             业务背景：
              - 旧版无全局 body 上限，oas_request_decoders_gen.go 的 ParseMultipartForm(32MB)
                超 32MB 部分会写 os.TempDir，攻击者可 POST 10GB multipart 写满磁盘
              - 慢连接配合大 Content-Length 也能耗光连接 pool
              - 现策略：路径分流，文件上传给 cfg.FileMaxSize + 余量，其它端点全局 1MB

             不在 handler 内手写 size check 的原因：
              - ParseMultipartForm 是 ogen 生成代码内部调用，无法 hook 单文件
              - MaxBytesReader 在底层 io.Reader 阶段就拒，不会 buffer 超限数据到内存或临时盘

@author Atlas.oi
@date 2026-05-08
*/

package middleware

import "net/http"

// BodyLimit 用 http.MaxBytesReader 限制 r.Body 大小。
//
// 业务流程：
//  1. 进 middleware 时把 r.Body 替换成 MaxBytesReader 包装
//  2. next handler 任何 ReadAll/Decode/ParseMultipartForm 拿到的就是限长 reader
//  3. 超限读取时 reader 返 *http.MaxBytesError，handler 应翻译为 413
//  4. 同时 MaxBytesReader 会调 ResponseControl 关连接，避免客户端继续发剩余数据
//
// 参数：
//   - maxBytes：单请求 body 字节上限（HTTP header 不计在内）
//   - <=0 时不限（仅用于禁用场景的兜底）
func BodyLimit(maxBytes int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if maxBytes > 0 && r.Body != nil {
				r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
			}
			next.ServeHTTP(w, r)
		})
	}
}
