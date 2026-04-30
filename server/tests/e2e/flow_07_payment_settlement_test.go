/*
@file flow_07_payment_settlement_test.go
@description e2e flow #7：收款 + 开发者结算 → /api/me/earnings 视图。

             业务规则：
             - customer_in：项目应收（spec §6.7），累加 projects.total_received
             - dev_settlement：发给开发者的款，dev_earnings_view 强制按 user_id 过滤
             - GET /api/me/earnings 返回当前用户的结算汇总，per-project breakdown

             断言：
             1. 录入 dev1 1500 结算 → dev1 earnings.totalEarned >= 1500
             2. dev2 同时调 /api/me/earnings → totalEarned = 0（视图 user_id 过滤）

@author Atlas.oi
@date 2026-04-29
*/

package e2e

import (
	"net/http"
	"testing"
	"time"

	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFlow07_PaymentSettlementEarnings(t *testing.T) {
	require.NotNil(t, e2eEnv)
	cs := newClient(e2eEnv.BaseURL)
	cs.loginAs(t, e2eEnv.CS)
	dev1 := newClient(e2eEnv.BaseURL)
	dev1.loginAs(t, e2eEnv.Dev1)
	dev2 := newClient(e2eEnv.BaseURL)
	dev2.loginAs(t, e2eEnv.Dev2)

	project := createProject(t, cs, "earnings-customer", "earnings-project",
		time.Now().Add(20*24*time.Hour), "5000.00")
	// 推到 delivered
	project = triggerEvent(t, cs, project.ID, "E1", "评估", nil)
	project = triggerEvent(t, dev1, project.ID, "E2", "评估完成", nil)
	project = triggerEvent(t, cs, project.ID, "E4", "客户接受", nil)
	project = triggerEvent(t, dev1, project.ID, "E7", "开发完成", nil)
	project = triggerEvent(t, cs, project.ID, "E9", "客户验收", nil)
	require.Equal(t, "delivered", project.Status)

	// 录 customer_in 5000
	recordPayment(t, cs, project.ID, "customer_in", "5000.00", "客户回款 5000", nil, nil)

	// 上传截图
	upResp := cs.uploadFile(t, "settlement-flow7.png", "image/png", uniquePNG())
	expectStatus(t, upResp, http.StatusCreated, "upload settlement screenshot")
	meta := decodeEnvelope[fileMetaModel](t, upResp)

	// 录 dev_settlement 1500 给 dev1
	dev1ID := e2eEnv.Dev1.ID
	screenshotID := meta.ID
	recordPayment(t, cs, project.ID, "dev_settlement", "1500.00", "结算给 dev1",
		&dev1ID, &screenshotID)

	// ============================================================
	// dev1 调 /api/me/earnings → totalEarned >= 1500
	// ============================================================
	dev1Resp := dev1.do(t, http.MethodGet, "/api/me/earnings", nil, true)
	expectStatus(t, dev1Resp, http.StatusOK, "dev1 earnings")
	dev1E := decodeEnvelope[earningsSummaryModel](t, dev1Resp)
	assert.Equal(t, e2eEnv.Dev1.ID, dev1E.UserID)

	dev1Total, err := decimal.NewFromString(dev1E.TotalEarned)
	require.NoError(t, err)
	assert.Truef(t, dev1Total.GreaterThanOrEqual(decimal.NewFromInt(1500)),
		"dev1 totalEarned 应 >= 1500，实际 %s", dev1E.TotalEarned)
	assert.GreaterOrEqual(t, dev1E.SettlementCount, 1)

	// ============================================================
	// dev2 调 /api/me/earnings → totalEarned = 0（视图过滤）
	// ============================================================
	dev2Resp := dev2.do(t, http.MethodGet, "/api/me/earnings", nil, true)
	expectStatus(t, dev2Resp, http.StatusOK, "dev2 earnings")
	dev2E := decodeEnvelope[earningsSummaryModel](t, dev2Resp)
	assert.Equal(t, e2eEnv.Dev2.ID, dev2E.UserID)

	dev2Total, err := decimal.NewFromString(dev2E.TotalEarned)
	require.NoError(t, err)
	assert.Truef(t, dev2Total.IsZero(),
		"dev2 totalEarned 应为 0（视图按 user_id 过滤），实际 %s", dev2E.TotalEarned)
	assert.Equal(t, 0, dev2E.SettlementCount)
}
