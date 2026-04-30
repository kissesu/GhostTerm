/*
@file flow_09_deadline_warning_test.go
@description e2e flow #9：deadline 临期警告。

             业务背景（cron/deadline_check.go）：
             - DeadlineChecker.Run 每 30 分钟扫；e2e 不能等
             - 直接构造 DeadlineChecker，注入"now=deadline-3 天"，调 CheckDeadlines 一次
             - 持球者（owner CS）应收到 deadline_approaching 通知

             这里走"直接对 e2e Pool + NotificationService 跑 cron 一次"的路径
             —— server 子进程的 cron 也在跑，但触发时机不可控；e2e 主进程显式触发更可靠。

             注意：e2e 主进程构造的 NotificationService 不持有 server 的 WSHub，
             所以仅写 DB notifications 表，不推 WS（本测试也不依赖 WS）。

@author Atlas.oi
@date 2026-04-29
*/

package e2e

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ghostterm/progress-server/internal/cron"
	"github.com/ghostterm/progress-server/internal/services"
)

func TestFlow09_DeadlineWarning(t *testing.T) {
	require.NotNil(t, e2eEnv)
	cs := newClient(e2eEnv.BaseURL)
	cs.loginAs(t, e2eEnv.CS)

	// 项目 deadline = now + 5 天（落入 <=7 天的 deadline_approaching 阈值）
	customer := createCustomer(t, cs, "deadline-customer")
	deadline := time.Now().Add(5 * 24 * time.Hour)
	project := createProject(t, cs, customer.ID, "deadline-project",
		deadline, "800.00")
	require.Equal(t, "dealing", project.Status)

	// ============================================================
	// 直接调 cron.CheckDeadlines（绕过 30 分钟周期）
	// 用 e2eEnv.Pool 构造 NotificationService（hub=nil 即可，本测试不验 WS 推送）
	// ============================================================
	notifSvc, err := services.NewNotificationService(services.NotificationServiceDeps{
		Pool: e2eEnv.Pool,
		Hub:  nil,
	})
	require.NoError(t, err)
	checker, err := cron.NewDeadlineChecker(cron.DeadlineCheckerDeps{
		Pool:     e2eEnv.Pool,
		NotifSvc: notifSvc,
		Interval: 1 * time.Hour, // 不会真用到，只是不能为 0
		Now:      func() time.Time { return time.Now() },
	})
	require.NoError(t, err)

	require.NoError(t, checker.CheckDeadlines(context.Background()),
		"CheckDeadlines 不应 error")

	// ============================================================
	// 当前 holder 是 CS（创建后 holder=cs creator），应收到 deadline_approaching
	// ============================================================
	notifs := listNotifications(t, cs)
	var found *notificationModel
	for i := range notifs {
		if notifs[i].Type == "deadline_approaching" &&
			notifs[i].ProjectID != nil && *notifs[i].ProjectID == project.ID {
			found = &notifs[i]
			break
		}
	}
	require.NotNil(t, found, "CS 应收到 deadline_approaching 通知")
	assert.Contains(t, found.Body, "5 天", "通知正文应含剩余天数")

	// ============================================================
	// 第二次调用：去重应跳过（同一类型 + 同 project 24h 窗口内只发一次）
	// ============================================================
	require.NoError(t, checker.CheckDeadlines(context.Background()))
	notifsAfter := listNotifications(t, cs)
	dupCount := 0
	for _, n := range notifsAfter {
		if n.Type == "deadline_approaching" && n.ProjectID != nil && *n.ProjectID == project.ID {
			dupCount++
		}
	}
	assert.Equal(t, 1, dupCount, "deadline_approaching 24h 内只发一次（去重）")

	// 用一次 GET 确保通知 endpoint 仍 200
	healthCheck := cs.do(t, http.MethodGet, "/api/notifications", nil, true)
	expectStatus(t, healthCheck, http.StatusOK, "notifications endpoint healthy after cron")
}
