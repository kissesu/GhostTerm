/*
@file flow_08_ws_notification_test.go
@description e2e flow #8：WS 票据 + 实时通知推送。

             业务流程（spec §8 + W2/C6）：
             1. Login → POST /api/ws/ticket 拿一次性 ticket
             2. WS dial /api/ws/notifications?ticket=<...>
             3. 触发反馈创建 → outbox worker（每 2s）→ ws_hub.Broadcast
             4. 客户端在 ~3s 内收到 JSON 通知

             断言：
             - WS 升级 200/Switching Protocols
             - 收到的消息含 type=new_feedback + 对应 projectId

@author Atlas.oi
@date 2026-04-29
*/

package e2e

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFlow08_WSNotification(t *testing.T) {
	require.NotNil(t, e2eEnv)
	cs := newClient(e2eEnv.BaseURL)
	cs.loginAs(t, e2eEnv.CS)
	dev := newClient(e2eEnv.BaseURL)
	dev.loginAs(t, e2eEnv.Dev1)

	// 创建项目（dev 自动 member）
	customer := createCustomer(t, cs, "ws-customer")
	project := createProject(t, cs, customer.ID, "ws-project",
		time.Now().Add(20*24*time.Hour), "1500.00")

	// ============================================================
	// 第一步：dev 取 WS ticket
	// ============================================================
	tResp := dev.do(t, http.MethodPost, "/api/ws/ticket", nil, true)
	expectStatus(t, tResp, http.StatusCreated, "issue ws ticket")
	ticket := decodeEnvelope[wsTicketModel](t, tResp)
	require.NotEmpty(t, ticket.Ticket)

	// ============================================================
	// 第二步：WS 升级
	// ============================================================
	wsURL := buildWSURL(e2eEnv.BaseURL, "/api/ws/notifications", ticket.Ticket)
	dialer := websocket.Dialer{HandshakeTimeout: 5 * time.Second}
	conn, resp, err := dialer.Dial(wsURL, nil)
	require.NoErrorf(t, err, "ws dial: %v body=%s", err, debugBody(resp))
	defer conn.Close()
	if resp != nil {
		assert.Equal(t, http.StatusSwitchingProtocols, resp.StatusCode)
	}

	// ============================================================
	// 第三步：CS 创建反馈（触发 new_feedback 通知 → outbox → broadcast）
	// 注：必须在 ws 升级完成后再触发，否则 broadcast 时 user 不在线，会落 outbox 慢路径
	// ============================================================
	fbResp := cs.do(t, http.MethodPost,
		urlf("/api/projects/%d/feedbacks", project.ID),
		map[string]any{"content": "ws 测试反馈", "source": "wechat"}, true)
	expectStatus(t, fbResp, http.StatusCreated, "create feedback for ws")

	// ============================================================
	// 第四步：循环读 WS 消息直到看到本测试创建的 new_feedback。
	//
	// 设计取舍：WS 通道是本用户的全部 outbox 推送通道；之前测试遗留的通知
	// （如 settlement_received）也可能此时被 flush 到该连接。
	// 用循环读 + 类型过滤，避免与并行测试或 outbox 排队互相干扰。
	// ============================================================
	type wsNotif struct {
		ID        int64  `json:"ID"`
		UserID    int64  `json:"UserID"`
		Type      string `json:"Type"`
		ProjectID *int64 `json:"ProjectID,omitempty"`
		Title     string `json:"Title"`
		Body      string `json:"Body"`
	}
	deadline := time.Now().Add(8 * time.Second)
	var matched *wsNotif
	for time.Now().Before(deadline) {
		conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		var n wsNotif
		if err := conn.ReadJSON(&n); err != nil {
			// 读超时 → 继续循环；其它 error → 失败
			if time.Now().After(deadline) {
				break
			}
			if ne, ok := err.(interface{ Timeout() bool }); ok && ne.Timeout() {
				continue
			}
			t.Fatalf("read ws notification: %v", err)
		}
		if n.Type == "new_feedback" && n.ProjectID != nil && *n.ProjectID == project.ID {
			matched = &n
			break
		}
		// 其它通知（之前测试遗留的）忽略
	}
	require.NotNil(t, matched, "应在 8s 内 WS 收到 new_feedback 通知（projectId=%d）", project.ID)
	assert.Equal(t, "new_feedback", matched.Type)
	assert.Equal(t, e2eEnv.Dev1.ID, matched.UserID, "通知收件人是 dev1")
}

// buildWSURL 把 http baseURL 改造为 ws://，并在 path 上追加 ticket 查询参数。
func buildWSURL(baseURL, path, ticket string) string {
	wsBase := strings.Replace(baseURL, "http://", "ws://", 1)
	wsBase = strings.Replace(wsBase, "https://", "wss://", 1)
	q := url.Values{}
	q.Set("ticket", ticket)
	return wsBase + path + "?" + q.Encode()
}

// debugBody 安全提取 dial 失败时的响应体（如 401 ErrorEnvelope JSON），便于排查。
func debugBody(resp *http.Response) string {
	if resp == nil {
		return ""
	}
	// 不读取（已被 dial 内部读完）；仅返回 status 提示
	return resp.Status
}
