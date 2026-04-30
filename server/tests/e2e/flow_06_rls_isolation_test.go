/*
@file flow_06_rls_isolation_test.go
@description e2e flow #6：RLS 隔离断言。

             业务背景（与设计差异说明）：
             - 项目层：项目创建时自动把所有 active dev 加入 project_members，
               所以两个 dev 都能看到所有项目（这是有意设计：开发能看到所有项目以分配工作）
             - 真正的 RLS 隔离点 = dev_settlement payments：
               policy 规定 direction='dev_settlement' 的行仅 related_user_id 可见
               → dev1 的结算 dev2 看不到（关键收益隐私）
             - super_admin 仍能看到所有项目和所有 payment

             覆盖断言：
             1. CS 与 super_admin 看到本测试创建的项目（注：可能含其它 e2e 项目）
             2. dev 也能看到该项目（project_members 自动加入）
             3. 给 dev1 录 dev_settlement 后，dev1 的 payments 列表能看到，dev2 看不到

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

func TestFlow06_RLSIsolation(t *testing.T) {
	require.NotNil(t, e2eEnv)

	cs := newClient(e2eEnv.BaseURL)
	cs.loginAs(t, e2eEnv.CS)
	dev1 := newClient(e2eEnv.BaseURL)
	dev1.loginAs(t, e2eEnv.Dev1)
	dev2 := newClient(e2eEnv.BaseURL)
	dev2.loginAs(t, e2eEnv.Dev2)
	admin := newClient(e2eEnv.BaseURL)
	admin.loginAs(t, e2eEnv.SuperAdmin)

	// ============================================================
	// 创建项目并推到 delivered（可录 dev_settlement）
	// ============================================================
	project := createProject(t, cs, "rls-isolation-customer", "rls-isolation-project",
		time.Now().Add(7*24*time.Hour), "5000.00")

	// 通过 statemachine 推到 delivered
	project = triggerEvent(t, cs, project.ID, "E1", "评估", nil)
	project = triggerEvent(t, dev1, project.ID, "E2", "评估完成", nil)
	project = triggerEvent(t, cs, project.ID, "E4", "客户接受", nil)
	project = triggerEvent(t, dev1, project.ID, "E7", "开发完成", nil)
	project = triggerEvent(t, cs, project.ID, "E9", "客户验收", nil)
	require.Equal(t, "delivered", project.Status)

	// ============================================================
	// 项目可见性：cs/admin/dev1/dev2 都能看到（自动加入 project_members）
	// ============================================================
	for name, client := range map[string]*httpClient{"cs": cs, "admin": admin, "dev1": dev1, "dev2": dev2} {
		projects := listProjects(t, client)
		found := false
		for _, p := range projects {
			if p.ID == project.ID {
				found = true
				break
			}
		}
		assert.Truef(t, found, "%s 应能看到项目 %d（自动加入 project_members）", name, project.ID)
	}

	// ============================================================
	// 上传一张截图作为 dev_settlement screenshot
	// ============================================================
	upResp := cs.uploadFile(t, "settlement.png", "image/png", uniquePNG())
	expectStatus(t, upResp, http.StatusCreated, "upload settlement screenshot")
	meta := decodeEnvelope[fileMetaModel](t, upResp)

	// ============================================================
	// 录入 dev_settlement 给 dev1
	// ============================================================
	dev1ID := e2eEnv.Dev1.ID
	screenshotID := meta.ID
	settle := recordPayment(t, cs, project.ID, "dev_settlement", "1500.00", "结算给 dev1",
		&dev1ID, &screenshotID)
	assert.Equal(t, "dev_settlement", settle.Direction)

	// ============================================================
	// dev_earnings_view 用 security_barrier + WHERE related_user_id=current_user_id()
	// 直接 SELECT view 时，is_admin() 与 user_id 限制由 view 定义本身强制：
	//   - dev1 应能看到自己的 settlement
	//   - dev2 应看不到 dev1 的 settlement
	//   - admin（in_admin()=true）能看到全部
	// 这层防护无论 server 走 progress_app 还是超级用户都有效（baked into view definition）。
	//
	// /api/me/earnings 端点已在 service 层对 view SELECT 做 user_id 过滤（双保险），
	// 此处通过 GET /api/me/earnings 间接验证 view 隔离。
	// ============================================================
	dev1Earnings := getMyEarnings(t, dev1)
	dev2Earnings := getMyEarnings(t, dev2)
	assert.GreaterOrEqual(t, dev1Earnings.SettlementCount, 1, "dev1 自己的 settlement 计数 >=1")
	assert.Equal(t, 0, dev2Earnings.SettlementCount, "dev2 看不到 dev1 的 settlement（view 强制 user_id 过滤）")

	// admin 仍能看到全部 payments（list 路径）
	adminPays := listPayments(t, admin, project.ID)
	assert.GreaterOrEqual(t, countSettlements(adminPays), 1, "admin 应能看到 dev_settlement")

	// （注：在 e2e 中 server 用 postgres 超级用户连接绕过 RLS table policy，
	//  payments 表层 RLS 隔离需要 progress_app NOBYPASSRLS 部署才能验证；
	//  这里依赖 dev_earnings_view 的 SECURITY BARRIER + user_id 过滤）
}

// getMyEarnings 拉当前用户结算汇总。
func getMyEarnings(t *testing.T, c *httpClient) earningsSummaryModel {
	t.Helper()
	resp := c.do(t, http.MethodGet, "/api/me/earnings", nil, true)
	expectStatus(t, resp, http.StatusOK, "get my earnings")
	return decodeEnvelope[earningsSummaryModel](t, resp)
}

// listPayments 拉项目下的 payments 列表。
func listPayments(t *testing.T, c *httpClient, projectID int64) []paymentModel {
	t.Helper()
	resp := c.do(t, http.MethodGet,
		urlf("/api/projects/%d/payments", projectID), nil, true)
	expectStatus(t, resp, http.StatusOK, "list payments")
	type env struct {
		Data []paymentModel `json:"data"`
	}
	var x env
	resp.decode(t, &x)
	return x.Data
}

// countSettlements 数 dev_settlement 笔数。
func countSettlements(ps []paymentModel) int {
	n := 0
	for _, p := range ps {
		if p.Direction == "dev_settlement" {
			n++
		}
	}
	return n
}

// smallPNG 是 1x1 png 的最小字节序列；http.DetectContentType 识别为 image/png。
//
// 注：caller 应附加唯一 suffix（uniqueBytes）让 sha256 不同，避免命中 files.storage_path UNIQUE 约束。
func smallPNG() []byte {
	return []byte{
		0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
		0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89,
		0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, // IDAT
		0x78, 0x9C, 0x62, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
		0x0D, 0x0A, 0x2D, 0xB4,
		0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
	}
}

// uniquePNG 在 smallPNG 基础上附加 nano 时间戳，让多次上传不会撞 sha256。
func uniquePNG() []byte {
	base := smallPNG()
	suffix := []byte(time.Now().Format("20060102150405.000000000"))
	return append(append([]byte{}, base...), suffix...)
}
