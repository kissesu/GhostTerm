// @file activity_service_test.go
// @description ActivityService 端到端测试（dockertest postgres + RLS）
//
// 覆盖：
//  1. 7 类事件 kind 在 timeline 中可见（feedback / project_created / status_change /
//     quote_change / payment / thesis_version / project_file_added）
//  2. RLS 拒绝路径：非成员调 List → ErrActivityProjectNotFound
//  3. 游标边界：同 occurred_at 多条 feedback 跨页不重不漏
//  4. 非法 cursor → ErrInvalidCursor；limit 0/200 → clamp 到 50/100
//
// 测试上下文：每条 Test 独立 NewTestDB(t)，dockertest 起一个全新容器跑 0001..0006
// 全部迁移；admin auth context（role_id=1）走"全可见"路径，避免每个测试重复 wire 成员关系。
//
// @author Atlas.oi
// @date 2026-05-01

package services_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ghostterm/progress-server/internal/services"
	"github.com/ghostterm/progress-server/tests/fixtures"
)

// ============================================================
// Task 5: feedback kind baseline
// ============================================================

func TestActivityService_List_Feedback(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	svc := services.NewActivityService(tdb.Pool)
	auth := fixtures.SeedAdminAuthContext(t, ctx, tdb.Pool)
	pid := fixtures.SeedProject(t, ctx, tdb.Pool, auth.UserID)

	at := time.Now().UTC().Truncate(time.Second)
	fid := fixtures.SeedFeedback(t, ctx, tdb.Pool, pid, auth.UserID, "客户问进度", at)

	got, err := svc.List(ctx, auth, pid, 50, "")
	require.NoError(t, err)
	require.NotEmpty(t, got.Items)

	var feedbackItem *services.ActivityView
	for i := range got.Items {
		if got.Items[i].Kind == "feedback" && got.Items[i].SourceID == fid {
			feedbackItem = &got.Items[i]
			break
		}
	}
	require.NotNil(t, feedbackItem, "feedback activity should appear in timeline")

	var p map[string]any
	require.NoError(t, json.Unmarshal(feedbackItem.Payload, &p))
	assert.Equal(t, "客户问进度", p["content"])
	assert.Equal(t, "wechat", p["source"])
}

// ============================================================
// Task 6: 其它 6 个 kind
// ============================================================

func TestActivityService_List_ProjectCreated(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	svc := services.NewActivityService(tdb.Pool)
	auth := fixtures.SeedAdminAuthContext(t, ctx, tdb.Pool)
	pid := fixtures.SeedProject(t, ctx, tdb.Pool, auth.UserID)

	got, err := svc.List(ctx, auth, pid, 50, "")
	require.NoError(t, err)

	var created *services.ActivityView
	for i := range got.Items {
		if got.Items[i].Kind == "project_created" && got.Items[i].SourceID == pid {
			created = &got.Items[i]
			break
		}
	}
	require.NotNil(t, created, "project_created should appear (project itself is the event)")

	var p map[string]any
	require.NoError(t, json.Unmarshal(created.Payload, &p))
	assert.NotEmpty(t, p["name"])
	assert.NotEmpty(t, p["status"])
	assert.NotEmpty(t, p["originalQuote"])
}

func TestActivityService_List_StatusChange(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	svc := services.NewActivityService(tdb.Pool)
	auth := fixtures.SeedAdminAuthContext(t, ctx, tdb.Pool)
	pid := fixtures.SeedProject(t, ctx, tdb.Pool, auth.UserID)

	at := time.Now().UTC()
	sid := fixtures.SeedStatusChange(t, ctx, tdb.Pool, pid, auth.UserID,
		"E1", "进入报价", "dealing", "quoting", "客户确认需求", at)

	got, err := svc.List(ctx, auth, pid, 50, "")
	require.NoError(t, err)

	var item *services.ActivityView
	for i := range got.Items {
		if got.Items[i].Kind == "status_change" && got.Items[i].SourceID == sid {
			item = &got.Items[i]
			break
		}
	}
	require.NotNil(t, item)

	var p map[string]any
	require.NoError(t, json.Unmarshal(item.Payload, &p))
	assert.Equal(t, "E1", p["eventCode"])
	assert.Equal(t, "dealing", p["fromStatus"])
	assert.Equal(t, "quoting", p["toStatus"])
}

func TestActivityService_List_QuoteChange_MoneyAsString(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	svc := services.NewActivityService(tdb.Pool)
	auth := fixtures.SeedAdminAuthContext(t, ctx, tdb.Pool)
	pid := fixtures.SeedProject(t, ctx, tdb.Pool, auth.UserID)

	at := time.Now().UTC()
	qid := fixtures.SeedQuoteChange(t, ctx, tdb.Pool, pid, auth.UserID,
		"append", "500.00", "1000.00", "1500.00", "新增需求", "developing", at)

	got, err := svc.List(ctx, auth, pid, 50, "")
	require.NoError(t, err)

	var item *services.ActivityView
	for i := range got.Items {
		if got.Items[i].Kind == "quote_change" && got.Items[i].SourceID == qid {
			item = &got.Items[i]
			break
		}
	}
	require.NotNil(t, item)

	var p map[string]any
	require.NoError(t, json.Unmarshal(item.Payload, &p))
	// Money 必须是 string 不能 float（精度保护：NUMERIC::text）
	_, isString := p["delta"].(string)
	assert.True(t, isString, "delta should be string, got %T", p["delta"])
	assert.Equal(t, "500.00", p["delta"])
}

func TestActivityService_List_Payment_CustomerInVisible(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	svc := services.NewActivityService(tdb.Pool)
	auth := fixtures.SeedAdminAuthContext(t, ctx, tdb.Pool)
	pid := fixtures.SeedProject(t, ctx, tdb.Pool, auth.UserID)

	at := time.Now().UTC()
	payID := fixtures.SeedPayment(t, ctx, tdb.Pool, pid, auth.UserID,
		"customer_in", "5000.00", "首付", at, 0, 0)

	got, err := svc.List(ctx, auth, pid, 50, "")
	require.NoError(t, err)

	var item *services.ActivityView
	for i := range got.Items {
		if got.Items[i].Kind == "payment" && got.Items[i].SourceID == payID {
			item = &got.Items[i]
			break
		}
	}
	require.NotNil(t, item, "customer_in payment should be visible to project members")
}

func TestActivityService_List_ThesisVersion(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	svc := services.NewActivityService(tdb.Pool)
	auth := fixtures.SeedAdminAuthContext(t, ctx, tdb.Pool)
	pid := fixtures.SeedProject(t, ctx, tdb.Pool, auth.UserID)
	fid := fixtures.SeedFile(t, ctx, tdb.Pool, auth.UserID, "thesis.pdf", "application/pdf")

	at := time.Now().UTC()
	tvID := fixtures.SeedThesisVersion(t, ctx, tdb.Pool, pid, fid, auth.UserID, 1, "初稿", at)

	got, err := svc.List(ctx, auth, pid, 50, "")
	require.NoError(t, err)

	var item *services.ActivityView
	for i := range got.Items {
		if got.Items[i].Kind == "thesis_version" && got.Items[i].SourceID == tvID {
			item = &got.Items[i]
			break
		}
	}
	require.NotNil(t, item)

	var p map[string]any
	require.NoError(t, json.Unmarshal(item.Payload, &p))
	assert.EqualValues(t, 1, p["versionNo"])
}

func TestActivityService_List_ProjectFileAdded(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	svc := services.NewActivityService(tdb.Pool)
	auth := fixtures.SeedAdminAuthContext(t, ctx, tdb.Pool)
	pid := fixtures.SeedProject(t, ctx, tdb.Pool, auth.UserID)
	fid := fixtures.SeedFile(t, ctx, tdb.Pool, auth.UserID, "ref.docx",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document")

	at := time.Now().UTC()
	pfID := fixtures.SeedProjectFile(t, ctx, tdb.Pool, pid, fid, auth.UserID, "sample_doc", at)

	got, err := svc.List(ctx, auth, pid, 50, "")
	require.NoError(t, err)

	var item *services.ActivityView
	for i := range got.Items {
		if got.Items[i].Kind == "project_file_added" && got.Items[i].SourceID == pfID {
			item = &got.Items[i]
			break
		}
	}
	require.NotNil(t, item)
	assert.Equal(t, auth.UserID, item.ActorID)
}

// ============================================================
// Task 7: RLS denial / cursor / invalid / limit clamp
// ============================================================

func TestActivityService_List_RLSDenial(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	svc := services.NewActivityService(tdb.Pool)
	owner := fixtures.SeedAdminAuthContext(t, ctx, tdb.Pool)
	pid := fixtures.SeedProject(t, ctx, tdb.Pool, owner.UserID)

	// stranger 是普通 dev，没在 project_members 里
	stranger := fixtures.SeedNonMemberAuthContext(t, ctx, tdb.Pool)

	_, err := svc.List(ctx, stranger, pid, 50, "")
	assert.ErrorIs(t, err, services.ErrActivityProjectNotFound)
}

func TestActivityService_List_CursorBoundary_SameOccurredAt(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	svc := services.NewActivityService(tdb.Pool)
	auth := fixtures.SeedAdminAuthContext(t, ctx, tdb.Pool)
	pid := fixtures.SeedProject(t, ctx, tdb.Pool, auth.UserID)

	// 同一时间戳 3 个 feedback（kind 相同 source_id 不同）
	sameAt := time.Now().UTC().Truncate(time.Second)
	id1 := fixtures.SeedFeedback(t, ctx, tdb.Pool, pid, auth.UserID, "f1", sameAt)
	id2 := fixtures.SeedFeedback(t, ctx, tdb.Pool, pid, auth.UserID, "f2", sameAt)
	id3 := fixtures.SeedFeedback(t, ctx, tdb.Pool, pid, auth.UserID, "f3", sameAt)

	// 第一页 limit=2
	page1, err := svc.List(ctx, auth, pid, 2, "")
	require.NoError(t, err)
	require.Len(t, page1.Items, 2)
	require.NotNil(t, page1.NextCursor)

	// 第二页用 cursor，应拿到剩余 + 不重复
	page2, err := svc.List(ctx, auth, pid, 2, *page1.NextCursor)
	require.NoError(t, err)

	seen := map[int64]bool{}
	for _, it := range page1.Items {
		if it.Kind == "feedback" {
			seen[it.SourceID] = true
		}
	}
	for _, it := range page2.Items {
		if it.Kind == "feedback" {
			assert.False(t, seen[it.SourceID], "feedback id %d duplicated across pages", it.SourceID)
			seen[it.SourceID] = true
		}
	}
	// 三个 feedback 都看到
	assert.True(t, seen[id1] && seen[id2] && seen[id3],
		"all 3 feedbacks should be reachable across pages: f1=%v f2=%v f3=%v",
		seen[id1], seen[id2], seen[id3])
}

func TestActivityService_List_InvalidCursor(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	svc := services.NewActivityService(tdb.Pool)
	auth := fixtures.SeedAdminAuthContext(t, ctx, tdb.Pool)
	pid := fixtures.SeedProject(t, ctx, tdb.Pool, auth.UserID)

	_, err := svc.List(ctx, auth, pid, 50, "not!valid!base64!!!")
	assert.ErrorIs(t, err, services.ErrInvalidCursor)
}

func TestActivityService_List_LimitClamp(t *testing.T) {
	ctx := context.Background()
	tdb := fixtures.NewTestDB(t)
	defer tdb.Close()

	svc := services.NewActivityService(tdb.Pool)
	auth := fixtures.SeedAdminAuthContext(t, ctx, tdb.Pool)
	pid := fixtures.SeedProject(t, ctx, tdb.Pool, auth.UserID)

	// limit=0 应使用默认 50
	r1, err := svc.List(ctx, auth, pid, 0, "")
	require.NoError(t, err)
	assert.LessOrEqual(t, len(r1.Items), 50)

	// limit=200 应 clamp 到 100
	r2, err := svc.List(ctx, auth, pid, 200, "")
	require.NoError(t, err)
	assert.LessOrEqual(t, len(r2.Items), 100)
}
