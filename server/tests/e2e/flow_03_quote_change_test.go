/*
@file flow_03_quote_change_test.go
@description e2e flow #3：费用变更（append 类型 → current_quote += delta）。

             业务规则（spec §6.4）：
             - changeType=append：客户加新功能，delta 必填，
               服务端 FOR UPDATE 锁项目行后，current_quote += delta
             - 费用变更日志记入 quote_change_logs，前端可读

             断言：
             1. POST 后返回 201 + 完整 QuoteChange envelope
             2. 项目 current_quote 由 1000 涨到 1200
             3. GET 列表返回 1 条变更

@author Atlas.oi
@date 2026-04-29
*/

package e2e

import (
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFlow03_QuoteChange(t *testing.T) {
	require.NotNil(t, e2eEnv)
	cs := newClient(e2eEnv.BaseURL)
	cs.loginAs(t, e2eEnv.CS)

	project := createProject(t, cs, "quote-change-customer", "quote-change-project",
		time.Now().Add(20*24*time.Hour), "1000.00")
	require.Equal(t, "1000.00", project.CurrentQuote)

	// ============================================================
	// POST 费用变更：append 200
	// ============================================================
	resp := cs.do(t, http.MethodPost,
		urlf("/api/projects/%d/quote-changes", project.ID),
		map[string]any{
			"changeType": "append",
			"delta":      "200.00",
			"reason":     "新增功能：批量导入",
		}, true)
	expectStatus(t, resp, http.StatusCreated, "create quote change")
	change := decodeEnvelope[quoteChangeModel](t, resp)
	assert.Equal(t, "append", change.ChangeType)
	assert.Equal(t, "1000.00", change.OldQuote)
	assert.Equal(t, "1200.00", change.NewQuote)

	// ============================================================
	// GET project 校验 current_quote = 1200
	// ============================================================
	getResp := cs.do(t, http.MethodGet, urlf("/api/projects/%d", project.ID), nil, true)
	expectStatus(t, getResp, http.StatusOK, "get project after quote change")
	updated := decodeEnvelope[projectModel](t, getResp)
	assert.Equal(t, "1200.00", updated.CurrentQuote)
	assert.Equal(t, "1000.00", updated.OriginalQuote, "originalQuote 不变")

	// ============================================================
	// GET quote-changes 列表
	// ============================================================
	listResp := cs.do(t, http.MethodGet,
		urlf("/api/projects/%d/quote-changes", project.ID), nil, true)
	expectStatus(t, listResp, http.StatusOK, "list quote changes")
	type listEnv struct {
		Data []quoteChangeModel `json:"data"`
	}
	var list listEnv
	listResp.decode(t, &list)
	assert.Len(t, list.Data, 1, "quote-changes 列表应有 1 条")
}
