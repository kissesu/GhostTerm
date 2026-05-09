/**
 * @file events_sse_test.go
 * @description SSE handler 集成测试：模拟订阅 → 推事件 → 验帧；心跳定时推送
 * @author Atlas.oi
 * @date 2026-05-09
 */
package handlers

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ghostterm/progress-server/internal/services"
)

// sseStubAuth 为 SSE 集成测试提供最小 AuthService 实现。
// 只实现 VerifyWSTicket，其它方法 panic（测试不会触发）。
type sseStubAuth struct {
	uid    int64
	roleID int64
}

func (s sseStubAuth) Login(_ context.Context, _, _ string) (string, string, any, error) {
	panic("sseStubAuth: not used in SSE test")
}

func (s sseStubAuth) Refresh(_ context.Context, _ string) (string, string, error) {
	panic("sseStubAuth: not used in SSE test")
}

func (s sseStubAuth) Logout(_ context.Context, _ services.SessionContext) error {
	panic("sseStubAuth: not used in SSE test")
}

func (s sseStubAuth) VerifyAccessToken(_ context.Context, _ string) (services.SessionContext, error) {
	panic("sseStubAuth: not used in SSE test")
}

func (s sseStubAuth) Me(_ context.Context, _ services.SessionContext) (any, error) {
	panic("sseStubAuth: not used in SSE test")
}

func (s sseStubAuth) ChangePassword(_ context.Context, _ services.SessionContext, _, _ string) error {
	panic("sseStubAuth: not used in SSE test")
}

func (s sseStubAuth) UpdateMe(_ context.Context, _ services.SessionContext, _ services.UpdateMeInput) (any, error) {
	panic("sseStubAuth: not used in SSE test")
}

func (s sseStubAuth) IssueWSTicket(_ context.Context, _ services.SessionContext) (string, time.Time, error) {
	panic("sseStubAuth: not used in SSE test")
}

// VerifyWSTicket 是本 stub 唯一真实实现：返回构造好的 AuthContext
func (s sseStubAuth) VerifyWSTicket(_ context.Context, _ string) (services.SessionContext, error) {
	return services.AuthContext{UserID: s.uid, RoleID: s.roleID}, nil
}

// TestSSEHandler_InitialHeartbeat 验证连接建立后第一帧是开局心跳
func TestSSEHandler_InitialHeartbeat(t *testing.T) {
	hub := services.NewEventHub()
	auth := sseStubAuth{uid: 7, roleID: 1}
	srv := httptest.NewServer(NewEventsSSEHandler(auth, hub))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "?ticket=stub")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d，期待 200", resp.StatusCode)
	}

	br := bufio.NewReader(resp.Body)
	// 第一帧必须是开局心跳
	frame := readSSEFrame(t, br, 2*time.Second)
	if !strings.HasPrefix(frame, "event: heartbeat") {
		t.Fatalf("第一帧应是 heartbeat，got: %q", frame)
	}
	// 心跳 latestId 初始应是 0（没有任何事件发布过）
	dataLine := extractSSEDataLine(frame)
	var hb services.Heartbeat
	if err := json.Unmarshal([]byte(dataLine), &hb); err != nil {
		t.Fatalf("parse heartbeat: %v", err)
	}
	if hb.LatestID != 0 {
		t.Errorf("初始心跳 latestId = %d，期待 0", hb.LatestID)
	}
}

// TestSSEHandler_ReceivesPublishedEvent 验证：
// 1. 开局心跳正常
// 2. publish 一条业务事件后 client 收到 data 帧
// 3. 事件帧 ID = 1，type / TargetUserIDs 路由正确
func TestSSEHandler_ReceivesPublishedEvent(t *testing.T) {
	hub := services.NewEventHub()
	auth := sseStubAuth{uid: 7, roleID: 1}
	srv := httptest.NewServer(NewEventsSSEHandler(auth, hub))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "?ticket=stub")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}

	br := bufio.NewReader(resp.Body)

	// 消费开局心跳帧
	hbFrame := readSSEFrame(t, br, 2*time.Second)
	if !strings.HasPrefix(hbFrame, "event: heartbeat") {
		t.Fatalf("第一帧应是 heartbeat，got: %q", hbFrame)
	}

	// 50ms 后 publish 一条针对 userID=7 的业务事件
	go func() {
		time.Sleep(50 * time.Millisecond)
		hub.Publish(services.Event{
			Type:          services.EventProjectCreated,
			OccurredAt:    time.Now(),
			ActorUserID:   1,
			Data:          map[string]any{"id": 99, "name": "demo"},
			TargetUserIDs: []int64{7},
		})
	}()

	evtFrame := readSSEFrame(t, br, 2*time.Second)
	// 业务事件帧只有 data 行，没有 event: 前缀
	dataLine := extractSSEDataLine(evtFrame)
	if dataLine == "" {
		t.Fatalf("事件帧未找到 data 行，frame: %q", evtFrame)
	}

	var evt services.Event
	if err := json.Unmarshal([]byte(dataLine), &evt); err != nil {
		t.Fatalf("parse event: %v", err)
	}
	if evt.Type != services.EventProjectCreated {
		t.Errorf("event.type = %q，期待 %q", evt.Type, services.EventProjectCreated)
	}
	// ID 由 hub 在 Publish 时单调递增填入，第一条应是 1
	if evt.ID != 1 {
		t.Errorf("event.ID = %d，期待 1", evt.ID)
	}
}

// TestSSEHandler_MissingTicket 验证缺少 ticket 时返回 401
func TestSSEHandler_MissingTicket(t *testing.T) {
	hub := services.NewEventHub()
	auth := sseStubAuth{uid: 7, roleID: 1}
	srv := httptest.NewServer(NewEventsSSEHandler(auth, hub))
	defer srv.Close()

	resp, err := http.Get(srv.URL) // 无 ?ticket= 参数
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("缺少 ticket 应返回 401，got %d", resp.StatusCode)
	}
}

// readSSEFrame 从 bufio.Reader 读取一个完整 SSE 帧（以空行 \n 为结尾）。
// 超时后调用 t.Fatal 中止测试。
func readSSEFrame(t *testing.T, br *bufio.Reader, timeout time.Duration) string {
	t.Helper()
	deadline := time.Now().Add(timeout)
	var sb strings.Builder
	for {
		if time.Now().After(deadline) {
			t.Fatal("readSSEFrame: timeout 等待 SSE 帧")
		}
		line, err := br.ReadString('\n')
		if err != nil {
			t.Fatalf("readSSEFrame: read error: %v", err)
		}
		// SSE 帧以单独的空行（\n）结束
		if line == "\n" {
			return strings.TrimSuffix(sb.String(), "\n")
		}
		sb.WriteString(line)
	}
}

// extractSSEDataLine 从 SSE 帧文本中取出 "data: " 后的 JSON 字符串。
// 找不到时返回空串。
func extractSSEDataLine(frame string) string {
	for _, line := range strings.Split(frame, "\n") {
		if strings.HasPrefix(line, "data: ") {
			return strings.TrimPrefix(line, "data: ")
		}
	}
	return ""
}
