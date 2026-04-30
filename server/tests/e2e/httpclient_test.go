/*
@file httpclient.go
@description e2e 测试专用 HTTP client。封装 Login → 持有 access token →
             后续请求自动带 Authorization: Bearer 头。

             设计取舍：
             - 不引入 codegen openapi-go-client：e2e 验证的是"真实 HTTP wire"，
               包括 ogen 序列化层；引 client 反而绕过实际的 marshalling 路径
             - 用裸 net/http + json marshal/unmarshal，flow 测试代码量略大，
               但可读性高（每条 HTTP 调用都看得见）

@author Atlas.oi
@date 2026-04-29
*/

package e2e

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// httpClient 是 e2e flow 测试用的简易 HTTP client。
//
// 字段：
//   - baseURL:     server 基地址（http://127.0.0.1:port）
//   - http:        底层 net/http.Client（默认 10s 超时）
//   - accessToken: Login 后保存；非空时自动注入 Authorization 头
type httpClient struct {
	baseURL     string
	http        *http.Client
	accessToken string
	refreshToken string
	user        loginUserResponse
}

// loginUserResponse 是 /api/auth/login 返回 envelope.user 的字段。
//
// 仅声明 e2e 关心的字段；ogen 输出的 nullable 字段（roleId 等）按需补。
// 用户明确指令覆盖 spec §4：账号字段使用 username 而非 email。
type loginUserResponse struct {
	ID          int64  `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	RoleID      int64  `json:"roleId"`
	IsActive    bool   `json:"isActive"`
}

// loginEnvelope 是 /api/auth/login 完整响应体（{ data: { accessToken, refreshToken, user } }）。
type loginEnvelope struct {
	Data struct {
		AccessToken  string            `json:"accessToken"`
		RefreshToken string            `json:"refreshToken"`
		User         loginUserResponse `json:"user"`
	} `json:"data"`
}

// newClient 构造 baseURL 对应的 client（未登录态）。
func newClient(baseURL string) *httpClient {
	return &httpClient{
		baseURL: baseURL,
		http:    &http.Client{Timeout: 10 * time.Second},
	}
}

// loginAs 用 user 凭据登录并保存 token；测试入口便利封装。
//
// 任何 HTTP / 解码错误都通过 require.NoError 让测试 fail-fast。
func (c *httpClient) loginAs(t *testing.T, u testUser) {
	t.Helper()
	body := map[string]string{
		"username": u.Username,
		"password": u.Password,
	}
	resp := c.do(t, http.MethodPost, "/api/auth/login", body, false)
	require.Equalf(t, http.StatusOK, resp.statusCode,
		"login %s expected 200, got %d body=%s", u.Username, resp.statusCode, resp.bodyString())

	var env loginEnvelope
	require.NoError(t, json.Unmarshal(resp.body, &env), "decode login envelope")
	require.NotEmpty(t, env.Data.AccessToken, "accessToken must not be empty")
	c.accessToken = env.Data.AccessToken
	c.refreshToken = env.Data.RefreshToken
	c.user = env.Data.User
}

// logout 调 /api/auth/logout 让 token_version 自增。
func (c *httpClient) logout(t *testing.T) {
	t.Helper()
	resp := c.do(t, http.MethodPost, "/api/auth/logout", nil, true)
	require.Equalf(t, http.StatusNoContent, resp.statusCode,
		"logout expected 204, got %d body=%s", resp.statusCode, resp.bodyString())
	c.accessToken = ""
}

// httpResult 包装一次 HTTP 调用返回值，便于测试函数链式断言。
type httpResult struct {
	statusCode int
	body       []byte
	headers    http.Header
}

// bodyString 字符串视图，用于失败信息打印。
func (r httpResult) bodyString() string {
	return string(r.body)
}

// decode 反序列化 JSON 到 dst；失败 fail-fast。
func (r httpResult) decode(t *testing.T, dst any) {
	t.Helper()
	require.NoErrorf(t, json.Unmarshal(r.body, dst),
		"decode %T failed; body=%s", dst, r.bodyString())
}

// do 发送一次 HTTP 请求；body 为 nil/zero 时不写请求体；withAuth=true 时带 Bearer。
//
// 业务流程：
//  1. 序列化 body 为 JSON（map / struct 都行）
//  2. 构造 req，path 拼到 baseURL
//  3. withAuth 时附 Authorization 头
//  4. http.Do → 读完整 body → 关闭 → 返回 statusCode + 完整 body
//
// 设计取舍：
//   - 一次性读完 body（io.ReadAll）后就关闭，避免 goroutine leak；e2e body 通常 <100KB
//   - context 用 context.Background()：超时由 c.http.Timeout 兜底
func (c *httpClient) do(t *testing.T, method, path string, body any, withAuth bool) httpResult {
	t.Helper()
	var reqBody io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		require.NoError(t, err, "marshal body")
		reqBody = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(context.Background(), method, c.baseURL+path, reqBody)
	require.NoError(t, err, "new request")
	if reqBody != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if withAuth {
		require.NotEmpty(t, c.accessToken, "withAuth=true but client has no accessToken")
		req.Header.Set("Authorization", "Bearer "+c.accessToken)
	}
	return c.send(t, req)
}

// send 执行 req 并读完整响应。提取出来便于 multipart / 自定义 header 路径复用。
func (c *httpClient) send(t *testing.T, req *http.Request) httpResult {
	t.Helper()
	resp, err := c.http.Do(req)
	require.NoErrorf(t, err, "http.Do %s %s", req.Method, req.URL.String())
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	require.NoError(t, err, "read body")

	return httpResult{
		statusCode: resp.StatusCode,
		body:       raw,
		headers:    resp.Header.Clone(),
	}
}

// uploadFile 用 multipart 上传文件（测试 file API）。
//
// 为避免 mime/multipart 相关包依赖膨胀，直接拼最简 multipart body：
//   --BOUNDARY
//   Content-Disposition: form-data; name="file"; filename="X"
//   Content-Type: TYPE
//
//   <bytes>
//   --BOUNDARY--
func (c *httpClient) uploadFile(t *testing.T, filename, mime string, content []byte) httpResult {
	t.Helper()
	const boundary = "ghostterm-e2e-boundary"
	var buf bytes.Buffer
	fmt.Fprintf(&buf, "--%s\r\n", boundary)
	fmt.Fprintf(&buf, "Content-Disposition: form-data; name=\"file\"; filename=\"%s\"\r\n", filename)
	fmt.Fprintf(&buf, "Content-Type: %s\r\n\r\n", mime)
	buf.Write(content)
	fmt.Fprintf(&buf, "\r\n--%s--\r\n", boundary)

	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, c.baseURL+"/api/files", &buf)
	require.NoError(t, err)
	req.Header.Set("Content-Type", "multipart/form-data; boundary="+boundary)
	req.Header.Set("Authorization", "Bearer "+c.accessToken)
	return c.send(t, req)
}

// expectStatus 断言 HTTP 状态码；不符则 fail 并打印 body。
func expectStatus(t *testing.T, r httpResult, want int, msg string) {
	t.Helper()
	require.Equalf(t, want, r.statusCode, "%s: expected %d, got %d body=%s", msg, want, r.statusCode, r.bodyString())
}

// envelopeWith 是 ogen response envelope { "data": ... } 的通用解码器。
//
// 业务背景：API 设计中所有 200 单资源都包了一层 { data: T }，泛型函数节省样板。
type envelopeWith[T any] struct {
	Data T `json:"data"`
}

// decodeEnvelope 解码 result 的 body 到 envelope.data，返回 data。
func decodeEnvelope[T any](t *testing.T, r httpResult) T {
	t.Helper()
	var env envelopeWith[T]
	r.decode(t, &env)
	return env.Data
}

// trimBaseURL 仅作内部 sanity 用：去尾部 / 避免拼路径出现 //。
func trimBaseURL(s string) string {
	return strings.TrimRight(s, "/")
}
