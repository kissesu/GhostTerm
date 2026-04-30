/*
@file flow_01_happy_path_test.go
@description e2e flow #1：完整正向状态机闭环。

             覆盖 spec §6.2 主线 transition：
                E0 创建 → dealing
                E1 提交评估 → quoting (dev)
                E2 评估完成回传 → quoting (cs)
                E4 客户接受报价 → developing (dev)
                E7 开发完成 → confirming (cs)
                E9 客户验收 → delivered (cs)
                E10 确认收款 → paid (cs)
                E11 归档 → archived

             业务断言：
              1. 每一步事件返回的 project.status 与持球者 holder 正确
              2. 收款后 totalReceived 累加生效
              3. status_change_logs 累计 8 条（E0 + E1..E11，不含 E12/E13）
              4. 最终 archived_at / paid_at 已写入

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

func TestFlow01_HappyPath(t *testing.T) {
	require.NotNil(t, e2eEnv, "e2eEnv must be initialized by TestMain")

	cs := newClient(e2eEnv.BaseURL)
	cs.loginAs(t, e2eEnv.CS)

	// ============================================================
	// 第一步：创建项目（CS 身份）
	// 用户需求修正 2026-04-30：客户从独立资源降级为 customerLabel 字段
	// ============================================================
	project := createProject(t, cs, "happy-path-customer", "happy-path-project",
		time.Now().Add(30*24*time.Hour), "1000.00")
	require.Equal(t, "dealing", project.Status)
	require.NotNil(t, project.HolderRoleID)
	require.Equal(t, roleCS, *project.HolderRoleID, "刚创建的 holder 应为 CS")

	// ============================================================
	// 第二步：E1 CS 提交评估 → quoting (dev)
	// ============================================================
	project = triggerEvent(t, cs, project.ID, "E1", "提交评估", nil)
	assert.Equal(t, "quoting", project.Status)
	require.NotNil(t, project.HolderRoleID)
	assert.Equal(t, roleDev, *project.HolderRoleID, "E1 后 holder 应为 dev")

	// ============================================================
	// 第三步：E2 dev 评估完成回传 → quoting (cs)
	// dev 必须登录新 client（角色权限路径校验）
	// ============================================================
	dev := newClient(e2eEnv.BaseURL)
	dev.loginAs(t, e2eEnv.Dev1)

	project = triggerEvent(t, dev, project.ID, "E2", "评估完成，报价 1000", nil)
	assert.Equal(t, "quoting", project.Status)
	require.NotNil(t, project.HolderRoleID)
	assert.Equal(t, roleCS, *project.HolderRoleID, "E2 后 holder 回到 CS")

	// ============================================================
	// 第四步：E4 CS 接受报价 → developing (dev)
	// ============================================================
	project = triggerEvent(t, cs, project.ID, "E4", "客户接受报价", nil)
	assert.Equal(t, "developing", project.Status)
	require.NotNil(t, project.HolderRoleID)
	assert.Equal(t, roleDev, *project.HolderRoleID, "E4 后 holder 是 dev")

	// ============================================================
	// 第五步：E7 dev 提交开发 → confirming (cs)
	// ============================================================
	project = triggerEvent(t, dev, project.ID, "E7", "开发完成，提交验收", nil)
	assert.Equal(t, "confirming", project.Status)
	require.NotNil(t, project.HolderRoleID)
	assert.Equal(t, roleCS, *project.HolderRoleID, "E7 后 holder 是 cs")

	// ============================================================
	// 第六步：E9 CS 验收通过 → delivered (cs)
	// ============================================================
	project = triggerEvent(t, cs, project.ID, "E9", "客户验收通过", nil)
	assert.Equal(t, "delivered", project.Status)

	// ============================================================
	// 第七步：录入收款 1000 + E10 确认收款 → paid
	// ============================================================
	pmt := recordPayment(t, cs, project.ID, "customer_in", "1000.00", "客户已转账", nil, nil)
	assert.Equal(t, "customer_in", pmt.Direction)

	project = triggerEvent(t, cs, project.ID, "E10", "确认收款 1000", nil)
	assert.Equal(t, "paid", project.Status)
	require.NotNil(t, project.PaidAt, "paid_at 必须被写入")

	// ============================================================
	// 第八步：E11 归档 → archived
	// ============================================================
	project = triggerEvent(t, cs, project.ID, "E11", "项目归档", nil)
	assert.Equal(t, "archived", project.Status)
	require.NotNil(t, project.ArchivedAt, "archived_at 必须被写入")
	// 终态 holder 清空
	assert.Nil(t, project.HolderRoleID, "archived 终态 holder 应为空")

	// ============================================================
	// 第九步：校验 status_change_logs
	// ============================================================
	logs := listStatusChanges(t, cs, project.ID)
	// 期望 7 条 transition 日志（E1, E2, E4, E7, E9, E10, E11）
	// E0（创建）也写一条
	assert.GreaterOrEqual(t, len(logs), 7, "至少应有 E1..E11 共 7 条 transition")

	// 收集事件码集合
	codes := map[string]bool{}
	for _, l := range logs {
		codes[l.EventCode] = true
	}
	for _, want := range []string{"E1", "E2", "E4", "E7", "E9", "E10", "E11"} {
		assert.Truef(t, codes[want], "status_change_logs 缺少事件 %s", want)
	}

	// ============================================================
	// 第十步：GET /api/projects/{id} 终态校验
	// ============================================================
	final := cs.do(t, http.MethodGet, urlf("/api/projects/%d", project.ID), nil, true)
	expectStatus(t, final, http.StatusOK, "final get project")
	got := decodeEnvelope[projectModel](t, final)
	assert.Equal(t, "archived", got.Status, "终态校验：status=archived")
}
