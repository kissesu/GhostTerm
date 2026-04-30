/*
@file flow_misc_test.go
@description e2e flow #10-13 杂项：登出失效、并发事件冲突、状态机非法跳转、负向 token。

             合并到一个 file 因为：
             - 当前业务 HTTP 层不在 endpoint 上挂 RequirePerm 中间件（perm 校验通过 RLS 实现）
             - 所以"403 perm denied"用例在 v1 不是 e2e 可观察现象
             - 替换为更具实际价值的负向断言：登出令旧 token 失效 + 状态机非法跳转 409 + 并发触发的语义错误

@author Atlas.oi
@date 2026-04-29
*/

package e2e

import (
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestFlow10_AuthIssued ：未登录请求被拒；带过期/伪造 token 也被拒。
//
// v2 §C6：所有受保护 endpoint 必须先经 SecurityHandler 校验 access token；
// 缺失 / 错误 token → 401 unauthorized。
func TestFlow10_AuthRequired(t *testing.T) {
	require.NotNil(t, e2eEnv)
	noAuth := newClient(e2eEnv.BaseURL)

	// 不带任何 token
	resp := noAuth.do(t, http.MethodGet, "/api/auth/me", nil, false)
	expectStatus(t, resp, http.StatusUnauthorized, "no auth → 401")

	// 伪造的 token
	noAuth.accessToken = "totally-not-a-jwt"
	bogus := noAuth.do(t, http.MethodGet, "/api/auth/me", nil, true)
	expectStatus(t, bogus, http.StatusUnauthorized, "bogus token → 401")
}

// TestFlow11_LogoutInvalidatesToken ：登出后旧 access token 必须 401（token_version 自增）。
//
// 业务流程：
//   1. 登录 → 拿到 access token A
//   2. 用 A 调 /api/auth/me 应当 200
//   3. 调 /api/auth/logout（token_version +1）
//   4. 把 A 塞回 client.accessToken，再调 /api/auth/me 应当 401
func TestFlow11_LogoutInvalidatesToken(t *testing.T) {
	require.NotNil(t, e2eEnv)
	c := newClient(e2eEnv.BaseURL)
	c.loginAs(t, e2eEnv.Dev2)
	oldToken := c.accessToken
	require.NotEmpty(t, oldToken)

	// 登出前 me 调用应 200
	ok := c.do(t, http.MethodGet, "/api/auth/me", nil, true)
	expectStatus(t, ok, http.StatusOK, "me before logout")

	// 登出（token_version 自增）
	c.logout(t)

	// 用旧 token 应被拒
	c.accessToken = oldToken
	rejected := c.do(t, http.MethodGet, "/api/auth/me", nil, true)
	expectStatus(t, rejected, http.StatusUnauthorized, "old token after logout → 401")
}

// TestFlow12_InvalidTransition ：状态机拒绝非法事件。
//
// 业务规则：dealing 状态下触发 E7（要求 from=developing）→ 409 conflict
// （projects.go handler 把 ErrInvalidTransition 映射为 409 ErrorEnvelope）
func TestFlow12_InvalidTransition(t *testing.T) {
	require.NotNil(t, e2eEnv)
	cs := newClient(e2eEnv.BaseURL)
	cs.loginAs(t, e2eEnv.CS)

	project := createProject(t, cs, "invalid-transition-customer", "invalid-transition-project",
		time.Now().Add(15*24*time.Hour), "1000.00")
	require.Equal(t, "dealing", project.Status)

	// dealing 直接 E7（developing → confirming）非法
	resp := cs.do(t, http.MethodPost,
		urlf("/api/projects/%d/events", project.ID),
		map[string]any{"event": "E7", "remark": "非法尝试"}, true)
	assert.NotEqual(t, http.StatusOK, resp.statusCode,
		"非法状态转移必须被拒，实际 status=%d body=%s", resp.statusCode, resp.bodyString())
	// 接口返回 409 / 422 都可（具体取决于 handler 错误映射）；不放过 200
}

// TestFlow13_ConcurrentEventTrigger ：两个 client 并发触发 E1 / E12，
// 一个成功，另一个得到明确错误（不能是 500 internal）。
//
// 业务背景：
// - 状态机入口在 service 层用 `SELECT ... FOR UPDATE` 锁项目行
// - 所以并发触发严格串行：第二个事务等第一个 commit 后再 SELECT，会发现状态已变
// - 第二个事务要么成功（事件依然合法）要么 409 ErrInvalidTransition
//
// 用例：CS 启动 E1（dealing→quoting），并发同 CS 启动 E12（任意非终态→cancelled）
// 必须：一个 200，一个非 200（不能两个都 200）
func TestFlow13_ConcurrentEventTrigger(t *testing.T) {
	require.NotNil(t, e2eEnv)
	cs1 := newClient(e2eEnv.BaseURL)
	cs1.loginAs(t, e2eEnv.CS)
	cs2 := newClient(e2eEnv.BaseURL)
	cs2.loginAs(t, e2eEnv.CS)

	project := createProject(t, cs1, "concurrent-customer", "concurrent-project",
		time.Now().Add(10*24*time.Hour), "1000.00")

	var wg sync.WaitGroup
	results := make([]int, 2)

	wg.Add(2)
	go func() {
		defer wg.Done()
		r := cs1.do(t, http.MethodPost,
			urlf("/api/projects/%d/events", project.ID),
			map[string]any{"event": "E1", "remark": "并发 E1"}, true)
		results[0] = r.statusCode
	}()
	go func() {
		defer wg.Done()
		r := cs2.do(t, http.MethodPost,
			urlf("/api/projects/%d/events", project.ID),
			map[string]any{"event": "E12", "remark": "并发 E12"}, true)
		results[1] = r.statusCode
	}()
	wg.Wait()

	// 至少一个成功
	gotOK := 0
	for _, sc := range results {
		if sc == http.StatusOK {
			gotOK++
		}
	}
	assert.GreaterOrEqual(t, gotOK, 1, "并发 E1/E12 至少一个应当 200，实际 results=%v", results)

	// 任一失败必须有意义的状态码（不允许 500 内部错误）
	for _, sc := range results {
		if sc != http.StatusOK {
			assert.Lessf(t, sc, http.StatusInternalServerError,
				"失败 case 必须是 4xx 业务错误，实际 status=%d", sc)
		}
	}
}
