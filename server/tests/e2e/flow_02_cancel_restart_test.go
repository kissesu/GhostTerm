/*
@file flow_02_cancel_restart_test.go
@description e2e flow #2：E12 取消 + E13 重启取消。

             业务规则（spec §6.5 + statemachine.engine 快照还原）：
             - E12 把项目状态推到 cancelled，并把"取消前快照"写入 status_change_logs.from_*
             - E13 从 logs 读出最近一次 E12 的快照，把项目状态还原到取消前
             - 持球者 / 状态时间戳列均按快照精确还原

             覆盖断言：
             1. 推进到 developing 后触发 E12 → status=cancelled
             2. 立即触发 E13 → 还原回 developing，holder 还原回 dev1

@author Atlas.oi
@date 2026-04-29
*/

package e2e

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFlow02_CancelRestart(t *testing.T) {
	require.NotNil(t, e2eEnv)
	cs := newClient(e2eEnv.BaseURL)
	cs.loginAs(t, e2eEnv.CS)
	dev := newClient(e2eEnv.BaseURL)
	dev.loginAs(t, e2eEnv.Dev1)

	// ============================================================
	// 推进到 developing 状态
	// ============================================================
	customer := createCustomer(t, cs, "cancel-restart-customer")
	project := createProject(t, cs, customer.ID, "cancel-restart-project",
		time.Now().Add(15*24*time.Hour), "2000.00")
	project = triggerEvent(t, cs, project.ID, "E1", "评估", nil)
	project = triggerEvent(t, dev, project.ID, "E2", "评估完成", nil)
	project = triggerEvent(t, cs, project.ID, "E4", "客户接受", nil)
	require.Equal(t, "developing", project.Status)
	require.NotNil(t, project.HolderUserID, "developing 状态有具体 holder")
	developingHolderUser := *project.HolderUserID

	// ============================================================
	// E12 取消
	// ============================================================
	project = triggerEvent(t, cs, project.ID, "E12", "客户终止合作", nil)
	assert.Equal(t, "cancelled", project.Status)
	require.NotNil(t, project.CancelledAt)
	assert.Nil(t, project.HolderRoleID, "cancelled 终态 holder 清空")

	// ============================================================
	// E13 重启取消 → 还原 developing
	// ============================================================
	project = triggerEvent(t, cs, project.ID, "E13", "客户改变主意，恢复开发", nil)
	assert.Equal(t, "developing", project.Status, "E13 还原到 developing")
	require.NotNil(t, project.HolderRoleID)
	assert.Equal(t, roleDev, *project.HolderRoleID, "持球者还原为 dev 角色")
	require.NotNil(t, project.HolderUserID)
	assert.Equal(t, developingHolderUser, *project.HolderUserID, "持球者 user 还原为取消前那一位")

	// ============================================================
	// status_change_logs 中 E12 / E13 都有记录
	// ============================================================
	logs := listStatusChanges(t, cs, project.ID)
	codes := map[string]int{}
	for _, l := range logs {
		codes[l.EventCode]++
	}
	assert.Equal(t, 1, codes["E12"], "E12 一次")
	assert.Equal(t, 1, codes["E13"], "E13 一次")
}
