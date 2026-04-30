/*
@file helpers.go
@description e2e flow 测试共用 helper（创建客户、创建项目、触发事件等高频操作）。
             避免每个 flow_*_test.go 重复写相同的 setup 序列。

@author Atlas.oi
@date 2026-04-29
*/

package e2e

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// projectModel 是 e2e 视角的简化项目模型；只声明测试需要的字段。
//
// 业务背景：完整 oas.Project 字段非常多，e2e 关心的只是状态机相关
// （status / holderRoleId / holderUserId / *_at）+ 金额字段；
// 其它字段以 raw json 形式不解码。
type projectModel struct {
	ID            int64      `json:"id"`
	Name          string     `json:"name"`
	CustomerID    int64      `json:"customerId"`
	Description   string     `json:"description"`
	Status        string     `json:"status"`
	HolderRoleID  *int64     `json:"holderRoleId,omitempty"`
	HolderUserID  *int64     `json:"holderUserId,omitempty"`
	OriginalQuote string     `json:"originalQuote"`
	CurrentQuote  string     `json:"currentQuote"`
	TotalReceived string     `json:"totalReceived"`
	Deadline      time.Time  `json:"deadline"`
	DealingAt     time.Time  `json:"dealingAt"`
	CancelledAt   *time.Time `json:"cancelledAt,omitempty"`
	PaidAt        *time.Time `json:"paidAt,omitempty"`
	ArchivedAt    *time.Time `json:"archivedAt,omitempty"`
}

// customerModel e2e 视角的客户。
type customerModel struct {
	ID         int64  `json:"id"`
	NameWechat string `json:"nameWechat"`
	CreatedBy  int64  `json:"createdBy"`
}

// statusChangeLogModel e2e 视角的状态变更日志。
type statusChangeLogModel struct {
	ID          int64     `json:"id"`
	ProjectID   int64     `json:"projectId"`
	EventCode   string    `json:"eventCode"`
	EventName   string    `json:"eventName"`
	FromStatus  *string   `json:"fromStatus,omitempty"`
	ToStatus    string    `json:"toStatus"`
	Remark      string    `json:"remark"`
	TriggeredBy int64     `json:"triggeredBy"`
	TriggeredAt time.Time `json:"triggeredAt"`
}

// notificationModel e2e 视角的通知。
type notificationModel struct {
	ID        int64     `json:"id"`
	UserID    int64     `json:"userId"`
	Type      string    `json:"type"`
	ProjectID *int64    `json:"projectId,omitempty"`
	Title     string    `json:"title"`
	Body      string    `json:"body"`
	IsRead    bool      `json:"isRead"`
	CreatedAt time.Time `json:"createdAt"`
}

// quoteChangeModel e2e 视角的费用变更记录。
type quoteChangeModel struct {
	ID         int64  `json:"id"`
	ProjectID  int64  `json:"projectId"`
	ChangeType string `json:"changeType"`
	Delta      string `json:"delta"`
	OldQuote   string `json:"oldQuote"`
	NewQuote   string `json:"newQuote"`
	Reason     string `json:"reason"`
}

// paymentModel e2e 视角的财务记录。
type paymentModel struct {
	ID            int64     `json:"id"`
	ProjectID     int64     `json:"projectId"`
	Direction     string    `json:"direction"`
	Amount        string    `json:"amount"`
	PaidAt        time.Time `json:"paidAt"`
	RelatedUserID *int64    `json:"relatedUserId,omitempty"`
	ScreenshotID  *int64    `json:"screenshotId,omitempty"`
	Remark        string    `json:"remark"`
	RecordedBy    int64     `json:"recordedBy"`
}

// fileMetaModel e2e 视角的文件元信息。
type fileMetaModel struct {
	ID        int64  `json:"id"`
	UUID      string `json:"uuid"`
	Filename  string `json:"filename"`
	SizeBytes int64  `json:"sizeBytes"`
	MimeType  string `json:"mimeType"`
}

// thesisVersionModel e2e 视角的论文版本。
type thesisVersionModel struct {
	ID        int64         `json:"id"`
	ProjectID int64         `json:"projectId"`
	FileID    int64         `json:"fileId"`
	VersionNo int           `json:"versionNo"`
	File      fileMetaModel `json:"file"`
}

// feedbackModel e2e 视角的反馈。
type feedbackModel struct {
	ID         int64  `json:"id"`
	ProjectID  int64  `json:"projectId"`
	Content    string `json:"content"`
	Source     string `json:"source"`
	Status     string `json:"status"`
	RecordedBy int64  `json:"recordedBy"`
}

// earningsSummaryModel e2e 视角的开发结算汇总。
type earningsSummaryModel struct {
	UserID          int64  `json:"userId"`
	TotalEarned     string `json:"totalEarned"`
	SettlementCount int    `json:"settlementCount"`
	Projects        []struct {
		ProjectID   int64  `json:"projectId"`
		ProjectName string `json:"projectName"`
		TotalEarned string `json:"totalEarned"`
	} `json:"projects"`
}

// wsTicketModel POST /api/ws/ticket 响应。
type wsTicketModel struct {
	Ticket    string    `json:"ticket"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// errorEnvelope e2e 看到的统一错误信封。
type errorEnvelope struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// ============================================================
// 操作 helper
// ============================================================

// createCustomer 通过 c 当前登录用户创建客户。
//
// 业务背景：customers_insert RLS 仅要求 current_user_id() 非空，
// 任何已登录身份都可建客户；e2e 默认让 cs 来建。
func createCustomer(t *testing.T, c *httpClient, name string) customerModel {
	t.Helper()
	resp := c.do(t, http.MethodPost, "/api/customers", map[string]any{
		"nameWechat": name,
		"remark":     "e2e 测试客户",
	}, true)
	expectStatus(t, resp, http.StatusCreated, "create customer "+name)
	return decodeEnvelope[customerModel](t, resp)
}

// createProject 创建项目并返回。caller 决定 customerID 与 deadline。
func createProject(t *testing.T, c *httpClient, customerID int64, name string, deadline time.Time, originalQuote string) projectModel {
	t.Helper()
	resp := c.do(t, http.MethodPost, "/api/projects", map[string]any{
		"name":          name,
		"customerId":    customerID,
		"description":   "e2e flow 测试",
		"deadline":      deadline.UTC().Format(time.RFC3339),
		"originalQuote": originalQuote,
	}, true)
	expectStatus(t, resp, http.StatusCreated, "create project "+name)
	return decodeEnvelope[projectModel](t, resp)
}

// triggerEvent 触发状态机事件，返回最新项目状态。
//
// 注：失败时把 body 打印出来，便于诊断状态机/RBAC 问题。
func triggerEvent(t *testing.T, c *httpClient, projectID int64, event, remark string, newHolder *int64) projectModel {
	t.Helper()
	body := map[string]any{
		"event":  event,
		"remark": remark,
	}
	if newHolder != nil {
		body["newHolderUserId"] = *newHolder
	}
	resp := c.do(t, http.MethodPost,
		urlf("/api/projects/%d/events", projectID), body, true)
	expectStatus(t, resp, http.StatusOK, "trigger "+event)
	return decodeEnvelope[projectModel](t, resp)
}

// triggerEventExpect 触发事件并断言指定 status，附带 body 调试信息。
func triggerEventExpect(t *testing.T, c *httpClient, projectID int64, event, remark string, expectStatusCode int) httpResult {
	t.Helper()
	body := map[string]any{
		"event":  event,
		"remark": remark,
	}
	resp := c.do(t, http.MethodPost,
		urlf("/api/projects/%d/events", projectID), body, true)
	expectStatus(t, resp, expectStatusCode, "trigger "+event)
	return resp
}

// listStatusChanges 拉项目状态变更日志。
func listStatusChanges(t *testing.T, c *httpClient, projectID int64) []statusChangeLogModel {
	t.Helper()
	resp := c.do(t, http.MethodGet,
		urlf("/api/projects/%d/status-changes", projectID), nil, true)
	expectStatus(t, resp, http.StatusOK, "list status changes")
	type listEnvelope struct {
		Data []statusChangeLogModel `json:"data"`
	}
	var env listEnvelope
	resp.decode(t, &env)
	return env.Data
}

// listProjects 拉当前用户可见的项目列表。
func listProjects(t *testing.T, c *httpClient) []projectModel {
	t.Helper()
	resp := c.do(t, http.MethodGet, "/api/projects", nil, true)
	expectStatus(t, resp, http.StatusOK, "list projects")
	type env struct {
		Data []projectModel `json:"data"`
	}
	var x env
	resp.decode(t, &x)
	return x.Data
}

// listNotifications 拉当前用户的通知。
func listNotifications(t *testing.T, c *httpClient) []notificationModel {
	t.Helper()
	resp := c.do(t, http.MethodGet, "/api/notifications", nil, true)
	expectStatus(t, resp, http.StatusOK, "list notifications")
	type env struct {
		Data []notificationModel `json:"data"`
	}
	var x env
	resp.decode(t, &x)
	return x.Data
}

// recordPayment 录入一条支付（customer_in 或 dev_settlement）。
func recordPayment(t *testing.T, c *httpClient, projectID int64, direction, amount, remark string, relatedUserID *int64, screenshotID *int64) paymentModel {
	t.Helper()
	body := map[string]any{
		"direction": direction,
		"amount":    amount,
		"paidAt":    time.Now().UTC().Format(time.RFC3339),
		"remark":    remark,
	}
	if relatedUserID != nil {
		body["relatedUserId"] = *relatedUserID
	}
	if screenshotID != nil {
		body["screenshotId"] = *screenshotID
	}
	resp := c.do(t, http.MethodPost,
		urlf("/api/projects/%d/payments", projectID), body, true)
	require.Equalf(t, http.StatusCreated, resp.statusCode,
		"record payment expected 201, got %d body=%s", resp.statusCode, resp.bodyString())
	return decodeEnvelope[paymentModel](t, resp)
}

// urlf 把 path 模板与参数拼成最终 URL；测试中比裸 fmt.Sprintf 更易读。
func urlf(format string, a ...any) string {
	return fmt.Sprintf(format, a...)
}
