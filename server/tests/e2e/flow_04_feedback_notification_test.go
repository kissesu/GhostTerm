/*
@file flow_04_feedback_notification_test.go
@description e2e flow #4：反馈触发 new_feedback 通知。

             业务规则（spec §7 + Phase 12 通知机制）：
             - CS 录入反馈 → 同事务给项目成员（除录入人外）发 new_feedback
             - 由于 project_members 创建时自动加入所有 active dev，dev1 应收到
             - 标记已读后未读计数减 1

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

func TestFlow04_FeedbackTriggersNotification(t *testing.T) {
	require.NotNil(t, e2eEnv)
	cs := newClient(e2eEnv.BaseURL)
	cs.loginAs(t, e2eEnv.CS)
	dev := newClient(e2eEnv.BaseURL)
	dev.loginAs(t, e2eEnv.Dev1)

	project := createProject(t, cs, "feedback-customer", "feedback-project",
		time.Now().Add(10*24*time.Hour), "500.00")

	// 记录 dev1 创建反馈前的通知数（基线）
	beforeNotifs := listNotifications(t, dev)
	baseCount := len(beforeNotifs)

	// ============================================================
	// CS 创建反馈
	// ============================================================
	resp := cs.do(t, http.MethodPost,
		urlf("/api/projects/%d/feedbacks", project.ID),
		map[string]any{
			"content": "客户希望首页加搜索框",
			"source":  "wechat",
		}, true)
	expectStatus(t, resp, http.StatusCreated, "create feedback")
	fb := decodeEnvelope[feedbackModel](t, resp)
	assert.Equal(t, project.ID, fb.ProjectID)

	// ============================================================
	// dev 通知列表新增 new_feedback
	// 需要等 outbox worker flush（每 2s）；轮询最多 6s 等通知出现
	// ============================================================
	deadline := time.Now().Add(6 * time.Second)
	var found *notificationModel
	for time.Now().Before(deadline) {
		notifs := listNotifications(t, dev)
		if len(notifs) > baseCount {
			for i := range notifs {
				if notifs[i].Type == "new_feedback" && notifs[i].ProjectID != nil && *notifs[i].ProjectID == project.ID {
					found = &notifs[i]
					break
				}
			}
		}
		if found != nil {
			break
		}
		time.Sleep(300 * time.Millisecond)
	}
	require.NotNil(t, found, "dev 应收到 new_feedback 通知")
	assert.False(t, found.IsRead, "新通知初始未读")

	// ============================================================
	// 标记已读
	// ============================================================
	mr := dev.do(t, http.MethodPost,
		urlf("/api/notifications/%d/read", found.ID), nil, true)
	expectStatus(t, mr, http.StatusNoContent, "mark read")

	// 再次拉取，确认 isRead=true
	after := listNotifications(t, dev)
	for _, n := range after {
		if n.ID == found.ID {
			assert.True(t, n.IsRead, "标记后通知 isRead=true")
			break
		}
	}
}
