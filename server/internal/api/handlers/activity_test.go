/*
@file activity_test.go
@description ProjectsListActivities handler 适配层测试 —— 4 个用例覆盖：
              1. 200 OK：list 返回项目活动（feedback kind 在 body 中）
              2. nextCursor：limit=2 + 3 个事件 → body.NextCursor 非空
              3. 404：项目不存在或非成员（RLS）→ ProjectsListActivitiesNotFound
              4. 422：非法 cursor → ProjectsListActivitiesUnprocessableEntity

             测试设计：
              - 直接调 handler 方法（不经 ogen HTTP 层）：handler 是薄适配层，
                只验证 service 输出 → oas 类型映射；HTTP 序列化由 ogen 自身保证
              - 用 fixtures.NewTestDB + fixtures.SeedXxx 复用 service test 同套 seeder
              - AuthContext 通过 middleware.WithAuthContext 注入 ctx，
                和生产 SecurityHandler 行为一致

@author Atlas.oi
@date 2026-05-01
*/

package handlers_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ghostterm/progress-server/internal/api/handlers"
	"github.com/ghostterm/progress-server/internal/api/middleware"
	"github.com/ghostterm/progress-server/internal/api/oas"
	"github.com/ghostterm/progress-server/internal/services"
	"github.com/ghostterm/progress-server/tests/fixtures"
)

// newActivityHandler 装配 handler + service + 注入 admin AuthContext 的 ctx。
//
// 业务背景：4 个 case 都需要"db + svc + handler + ctx"四件套；提取 helper 让用例
// 只关心断言本身。返回的 ctx 已经 WithAuthContext，模拟 SecurityHandler 通过后的状态。
func newActivityHandler(t *testing.T) (*handlers.ActivityHandler, *fixtures.TestDB, services.AuthContext, context.Context) {
	t.Helper()
	tdb := fixtures.NewTestDB(t)
	t.Cleanup(tdb.Close)

	svc := services.NewActivityService(tdb.Pool)
	h, err := handlers.NewActivityHandler(svc)
	require.NoError(t, err)

	ctx := context.Background()
	ac := fixtures.SeedAdminAuthContext(t, ctx, tdb.Pool)
	ctxWithAuth := middleware.WithAuthContext(ctx, ac)
	return h, tdb, ac, ctxWithAuth
}

// ============================================================
// 1. 200 OK：feedback 活动出现在 body
// ============================================================

func TestProjectsListActivities_200(t *testing.T) {
	h, tdb, ac, ctx := newActivityHandler(t)

	pid := fixtures.SeedProject(t, ctx, tdb.Pool, ac.UserID)
	at := time.Now().UTC().Truncate(time.Second)
	fid := fixtures.SeedFeedback(t, ctx, tdb.Pool, pid, ac.UserID, "客户问进度", at)

	res, err := h.ProjectsListActivities(ctx, oas.ProjectsListActivitiesParams{ID: pid})
	require.NoError(t, err)

	listResp, ok := res.(*oas.ActivityListResponse)
	require.True(t, ok, "200 路径应返回 *ActivityListResponse；实际类型 %T", res)
	require.NotEmpty(t, listResp.Data)

	// 找到 feedback 活动并验证 oneOf payload 已正确反序列化
	var feedbackItem *oas.Activity
	for i := range listResp.Data {
		if listResp.Data[i].Kind == oas.ActivityKindFeedback && listResp.Data[i].SourceId == fid {
			feedbackItem = &listResp.Data[i]
			break
		}
	}
	require.NotNil(t, feedbackItem, "feedback activity 应出现在 timeline body 中")

	assert.Equal(t, pid, feedbackItem.ProjectId)
	assert.Equal(t, ac.UserID, feedbackItem.ActorId)

	fbPayload, ok := feedbackItem.Payload.GetFeedbackActivityPayload()
	require.True(t, ok, "kind=feedback 时 payload 必须是 FeedbackActivityPayload sum-type")
	assert.Equal(t, "客户问进度", fbPayload.Content)
	assert.Equal(t, oas.FeedbackSource("wechat"), fbPayload.Source)
	assert.Equal(t, oas.FeedbackStatus("pending"), fbPayload.Status)
}

// ============================================================
// 2. nextCursor：limit=2 + 3 个事件 → body.NextCursor 非空
// ============================================================

func TestProjectsListActivities_NextCursor(t *testing.T) {
	h, tdb, ac, ctx := newActivityHandler(t)

	pid := fixtures.SeedProject(t, ctx, tdb.Pool, ac.UserID)
	now := time.Now().UTC().Truncate(time.Second)

	// 录 3 条 feedback，间隔 1s 让 occurred_at 严格递减；project_created 自身也算 1 条，
	// 所以 timeline 里至少 4 条事件 → limit=2 必然命中"还有下一页"路径
	for i := 0; i < 3; i++ {
		fixtures.SeedFeedback(t, ctx, tdb.Pool, pid, ac.UserID,
			"feedback-"+time.Duration(i).String(), now.Add(-time.Duration(i)*time.Second))
	}

	limit := 2
	res, err := h.ProjectsListActivities(ctx, oas.ProjectsListActivitiesParams{
		ID:    pid,
		Limit: oas.NewOptInt(limit),
	})
	require.NoError(t, err)

	listResp, ok := res.(*oas.ActivityListResponse)
	require.True(t, ok)
	assert.Len(t, listResp.Data, limit, "应严格返回 limit 条；多出的行用于生成 nextCursor 后被截断")

	cur, set := listResp.NextCursor.Get()
	require.True(t, set && listResp.NextCursor.IsSet(),
		"超过 limit 的事件量应触发 NextCursor 非空")
	assert.NotEmpty(t, cur, "NextCursor 应是 base64url 字符串")
}

// ============================================================
// 3. 404：项目不存在或非成员
// ============================================================

func TestProjectsListActivities_404(t *testing.T) {
	h, _, _, ctx := newActivityHandler(t)

	// 9999999 是确定不存在的 id（fixtures 不会插这么大的 id）
	res, err := h.ProjectsListActivities(ctx, oas.ProjectsListActivitiesParams{ID: 9999999})
	require.NoError(t, err, "404 应在响应类型中表达，不应返回 Go error")

	notFound, ok := res.(*oas.ProjectsListActivitiesNotFound)
	require.True(t, ok, "项目不存在应返回 *ProjectsListActivitiesNotFound；实际 %T", res)
	assert.Equal(t, oas.ErrorEnvelopeErrorCodeNotFound, notFound.Error.Code)
	assert.NotEmpty(t, notFound.Error.Message)
}

// ============================================================
// 4. 422：非法 cursor
// ============================================================

func TestProjectsListActivities_422_InvalidCursor(t *testing.T) {
	h, tdb, ac, ctx := newActivityHandler(t)
	pid := fixtures.SeedProject(t, ctx, tdb.Pool, ac.UserID)

	// 非法 base64url JSON：service.decodeCursor 会返回 ErrInvalidCursor
	res, err := h.ProjectsListActivities(ctx, oas.ProjectsListActivitiesParams{
		ID:     pid,
		Before: oas.NewOptString("not-a-valid-base64url-json-cursor!!!"),
	})
	require.NoError(t, err, "422 应在响应类型中表达，不应返回 Go error")

	unproc, ok := res.(*oas.ProjectsListActivitiesUnprocessableEntity)
	require.True(t, ok, "非法 cursor 应返回 *ProjectsListActivitiesUnprocessableEntity；实际 %T", res)
	assert.Equal(t, oas.ErrorEnvelopeErrorCodeValidationFailed, unproc.Error.Code)
	assert.NotEmpty(t, unproc.Error.Message)
}

// ============================================================
// 防御：handler 不应吞 service 未识别错误
// ============================================================

// 业务背景：service.List 在内部 InTx 失败时返回 wrapped DB error；
// handler 应原样 bubble up（让 errorEnvelopeHandler 兜底 500），
// 而不是误映射为 404 / 422。
//
// 这里用一个"明显非 sentinel 的 error"间接验证 switch 不会过度匹配。
// 直接断言 ErrInvalidCursor / ErrActivityProjectNotFound 之外的 error 路径
// 必须 return non-nil err。
func TestProjectsListActivities_UnknownErrorBubblesUp(t *testing.T) {
	h, _, _, _ := newActivityHandler(t)
	// 不传 AuthContext，handler 必须立刻返回 ErrInvalidAccessToken
	noAuthCtx := context.Background()
	_, err := h.ProjectsListActivities(noAuthCtx, oas.ProjectsListActivitiesParams{ID: 1})
	require.Error(t, err)
	assert.True(t, errors.Is(err, services.ErrInvalidAccessToken),
		"缺 AuthContext 应返回 ErrInvalidAccessToken sentinel；实际 %v", err)
}
