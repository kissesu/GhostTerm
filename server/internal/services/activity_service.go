// @file activity_service.go
// @description 进度时间线聚合 service —— 读取 project_activity_view + 游标分页 + RLS 上下文注入
//
// 业务流程：
//  1. SessionContext type-assert 为 AuthContext（失败 → ErrInvalidSessionContext）
//  2. limit clamp 到 [1, 100]，0/负数走默认 50
//  3. cursor decode（base64url JSON）；非法格式立即返回 ErrInvalidCursor
//  4. 进 InTx，第一行 SET LOCAL ROLE progress_app + SetSessionContext 注入 RLS GUC
//     —— SET LOCAL ROLE 让 dockertest 用的 postgres 超级用户也走 NOBYPASSRLS 路径，
//     与生产 progress_app 直连行为一致；本身在生产是幂等 no-op
//  5. SELECT EXISTS(projects WHERE id=$1) 做存在性 + 可见性双重 guard
//     RLS 屏蔽掉非成员可见的项目 → exists=false → 返回 ErrActivityProjectNotFound
//  6. 主查询 project_activity_view + LEFT JOIN users(display_name) + roles(name)
//     拿 actor 名/角色（VIEW 只携带 actor_id，name 从应用层 JOIN 拿）
//  7. 取 limit+1 行；超出则切片末位生成 nextCursor，items 截回 limit
//
// 设计取舍：
//   - 排序键三元组 (occurred_at DESC, kind DESC, source_id DESC) 与 cursor decode 严格对齐
//   - VIEW 已 UNION 全 7 表，service 不区分 kind —— 任何新事件类型只需在 VIEW 加 UNION
//
// @author Atlas.oi
// @date 2026-05-01

package services

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	progressdb "github.com/ghostterm/progress-server/internal/db"
)

// ErrActivityProjectNotFound 表示项目不存在或调用者无权访问（RLS 隐性屏蔽）。
//
// 业务背景：Spec 锁定决策 "RLS gives 0 rows; SELECT EXISTS catches and returns sentinel"。
// handler 层把此 sentinel 映射为 404，避免泄露"项目存在但你看不见"信号。
var ErrActivityProjectNotFound = errors.New("services: activity project not found or forbidden")

// ActivityView 是 service 层的活动视图模型（与 OAS Activity 1:1 映射，handler 层做转换）。
type ActivityView struct {
	ID            string // "{kind}:{sourceID}"，前端去重使用
	SourceID      int64
	ProjectID     int64
	Kind          string
	OccurredAt    time.Time
	ActorID       int64
	ActorName     *string // users.display_name；JOIN 缺行时 NULL（actor 用户被删）
	ActorUsername *string // users.username（登录账号）；用户原话"需要在右侧显示提交时间线的用户账号"
	ActorRoleName *string // roles.name；同上
	ClientIP      *string // 客户端 IP（INET → TEXT 转换）；migration 0008 加列，老行 NULL
	UserAgent     *string // User-Agent 头原值；migration 0008，老行 NULL
	Payload       json.RawMessage
}

// ListActivitiesResult 是 List 的返回值。
type ListActivitiesResult struct {
	Items      []ActivityView
	NextCursor *string // 仅当 DB 返回 > limit 行时填充；caller 据此判定是否还有下一页
}

// ActivityService 是 service 层接口。
type ActivityService interface {
	List(ctx context.Context, sc SessionContext, projectID int64, limit int, beforeCursor string) (ListActivitiesResult, error)
}

type activityService struct {
	pool   *pgxpool.Pool
	cipher *CipherService // finding #4：解密 feedback.content / payment.remark 密文 payload
}

// 编译时校验：activityService 必须满足 ActivityService interface
var _ ActivityService = (*activityService)(nil)

// NewActivityService 构造 ActivityService 实现。
//
// finding #4：cipher 必填 —— payload 中 feedback.content / payment.remark 是 BYTEA
// 经 view encode(bytea, 'base64') 嵌入 jsonb，service 必须解密后才能交给 handler。
// nil cipher 视为配置漂移立即拒绝。
func NewActivityService(pool *pgxpool.Pool, cipher *CipherService) (ActivityService, error) {
	if pool == nil {
		return nil, errors.New("activity_service: pool is required")
	}
	if cipher == nil {
		return nil, errors.New("activity_service: cipher is required")
	}
	return &activityService{pool: pool, cipher: cipher}, nil
}

// List 返回项目的进度时间线（按 occurred_at DESC, kind DESC, source_id DESC）。
func (s *activityService) List(
	ctx context.Context,
	sc SessionContext,
	projectID int64,
	limit int,
	beforeCursor string,
) (ListActivitiesResult, error) {
	ac, ok := sc.(AuthContext)
	if !ok {
		return ListActivitiesResult{}, ErrInvalidSessionContext
	}

	// limit clamp：0/负数 → 50（默认页大小）；> 100 → 100（防爆表）
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}

	cursor, err := decodeCursor(beforeCursor)
	if err != nil {
		return ListActivitiesResult{}, err
	}

	var out ListActivitiesResult

	err = progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		// SET LOCAL ROLE progress_app：让 RLS 在测试 / 超级用户连接下也强制生效；
		// 生产侧本来就以 progress_app 身份连接，此 SET 是幂等 no-op
		if _, err := tx.Exec(ctx, `SET LOCAL ROLE progress_app`); err != nil {
			return fmt.Errorf("activity_service: set role progress_app: %w", err)
		}
		// SET LOCAL jit = off：用户反馈 2026-05-03"每次进入进度详情页面... 3 秒以上才能加载"
		// project_activity_view 7 UNION + 多 LEFT JOIN + RLS check + jsonb_agg 让 plan cost
		// 超过默认 jit_above_cost (500000)，触发 PostgreSQL JIT 编译。EXPLAIN ANALYZE 显示
		// JIT Optimization+Emission 占 2.5 秒，比真实执行 (25ms) 慢 100 倍。小数据集 + 复杂
		// plan 是 JIT 反优化场景；关闭 JIT 让此 endpoint 从 2.5s 降到 ~50ms。
		if _, err := tx.Exec(ctx, `SET LOCAL jit = off`); err != nil {
			return fmt.Errorf("activity_service: disable jit: %w", err)
		}
		if err := progressdb.SetSessionContext(ctx, tx, ac.UserID, ac.RoleID); err != nil {
			return fmt.Errorf("activity_service: set rls context: %w", err)
		}

		// 项目存在性 + 可见性 guard：RLS 自动屏蔽非成员可见的项目，
		// SELECT EXISTS 既验证 (a) 行存在 (b) 当前 GUC 身份能看到。
		var exists bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM projects WHERE id = $1)
		`, projectID).Scan(&exists); err != nil {
			return fmt.Errorf("activity_service: membership guard: %w", err)
		}
		if !exists {
			return ErrActivityProjectNotFound
		}

		// 游标 WHERE：仅在 caller 显式传 cursor 时附加（首页查询不带）
		args := []any{projectID, limit + 1}
		whereCursor := ""
		if beforeCursor != "" {
			args = append(args, cursor.At, cursor.Kind, cursor.SourceID)
			whereCursor = `
				AND (
					av.occurred_at < $3
					OR (av.occurred_at = $3 AND av.kind < $4)
					OR (av.occurred_at = $3 AND av.kind = $4 AND av.source_id < $5)
				)
			`
		}

		// VIEW 不携带 actor 名/角色/账号，应用层 LEFT JOIN users + roles
		// 注：users 表字段是 display_name + username；migration 0001 §74-77
		// VIEW 携带 client_ip(INET)/user_agent，INET → TEXT 转换便于 pgx Scan 到 *string
		sqlStr := `
			SELECT
				(av.kind || ':' || av.source_id::text) AS id,
				av.source_id,
				av.project_id,
				av.kind,
				av.occurred_at,
				av.actor_id,
				u.display_name AS actor_name,
				u.username AS actor_username,
				r.name AS actor_role_name,
				host(av.client_ip) AS client_ip,
				av.user_agent,
				av.payload
			FROM project_activity_view av
			LEFT JOIN users u ON u.id = av.actor_id
			LEFT JOIN roles r ON r.id = u.role_id
			WHERE av.project_id = $1` + whereCursor + `
			ORDER BY av.occurred_at DESC, av.kind DESC, av.source_id DESC
			LIMIT $2
		`

		rows, err := tx.Query(ctx, sqlStr, args...)
		if err != nil {
			return fmt.Errorf("activity_service: query: %w", err)
		}
		defer rows.Close()

		items := make([]ActivityView, 0, limit+1)
		for rows.Next() {
			var a ActivityView
			if err := rows.Scan(
				&a.ID, &a.SourceID, &a.ProjectID, &a.Kind,
				&a.OccurredAt, &a.ActorID,
				&a.ActorName, &a.ActorUsername, &a.ActorRoleName,
				&a.ClientIP, &a.UserAgent,
				&a.Payload,
			); err != nil {
				return fmt.Errorf("activity_service: scan: %w", err)
			}
			items = append(items, a)
		}
		if err := rows.Err(); err != nil {
			return fmt.Errorf("activity_service: iterate: %w", err)
		}
		rows.Close()

		// finding #4：feedback / payment 分支 payload 中的 content/remark 字段
		// 在 view 里被 encode(bytea, 'base64') 嵌成 base64 string，service 解密回明文
		// 后替换 payload，前端拿到的仍是 string 类型，OAS contract 不变。
		for i := range items {
			decoded, err := s.decryptActivityPayload(ctx, items[i].Kind, items[i].Payload)
			if err != nil {
				return fmt.Errorf("activity_service: decrypt payload kind=%s id=%d: %w", items[i].Kind, items[i].SourceID, err)
			}
			items[i].Payload = decoded
		}

		// 取出 limit+1 行：超出 limit 即视为还有下一页，用第 limit 个（idx limit-1）
		// 行的三元组生成 cursor。这样 caller 用此 cursor 拉下一页时严格不重不漏。
		if len(items) > limit {
			last := items[limit-1]
			next, err := encodeCursor(activityCursor{
				At:       last.OccurredAt,
				Kind:     last.Kind,
				SourceID: last.SourceID,
			})
			if err != nil {
				return fmt.Errorf("activity_service: encode next cursor: %w", err)
			}
			out.NextCursor = &next
			items = items[:limit]
		}

		out.Items = items
		return nil
	})

	if err != nil {
		return ListActivitiesResult{}, err
	}
	return out, nil
}

// decryptActivityPayload 对 kind=feedback/payment 的 payload 解密 content/remark 字段。
//
// 业务流程（仅 feedback / payment 命中）：
//  1. unmarshal jsonb 到 map[string]json.RawMessage（保字段顺序无所谓，后端 ogen 自序列化）
//  2. 取出 fieldName 对应 raw（base64 字符串）
//  3. base64 decode → []byte 密文
//  4. cipher.Decrypt(columnName, ciphertext) → 明文 string
//  5. json.Marshal(string) → 替换 map[fieldName]
//  6. json.Marshal(map) → 返回新 payload
//
// 设计取舍：
//   - 失败必透出（不 silent fallback）：解密失败说明主密钥变更或数据损坏，
//     返 502/503 让运维介入比"返空字符串假装正常"安全
//   - 空 base64 字符串（fixture 用 0 字节密文 → encode=” 进 jsonb）→ Decrypt
//     接受空 []byte 返 ""，不再二次报错
//   - 其它 5 个 kind 直接 passthrough，不浪费 unmarshal 开销
func (s *activityService) decryptActivityPayload(ctx context.Context, kind string, payload json.RawMessage) (json.RawMessage, error) {
	var fieldName, columnName string
	switch kind {
	case "feedback":
		fieldName, columnName = "content", "feedbacks_content"
	case "payment":
		fieldName, columnName = "remark", "payments_remark"
	default:
		return payload, nil
	}

	var m map[string]json.RawMessage
	if err := json.Unmarshal(payload, &m); err != nil {
		return nil, fmt.Errorf("activity payload unmarshal: %w", err)
	}
	encField, ok := m[fieldName]
	if !ok {
		// 字段不存在视为合法（不应该发生但兜底）
		return payload, nil
	}
	var b64 string
	if err := json.Unmarshal(encField, &b64); err != nil {
		return nil, fmt.Errorf("activity payload %s base64 unmarshal: %w", fieldName, err)
	}
	if b64 == "" {
		return payload, nil
	}
	ciphertext, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, fmt.Errorf("activity payload %s base64 decode: %w", fieldName, err)
	}
	plaintext, err := s.cipher.Decrypt(ctx, columnName, ciphertext)
	if err != nil {
		return nil, fmt.Errorf("activity payload %s decrypt: %w", fieldName, err)
	}
	plainJSON, err := json.Marshal(plaintext)
	if err != nil {
		return nil, fmt.Errorf("activity payload %s remarshal: %w", fieldName, err)
	}
	m[fieldName] = plainJSON
	out, err := json.Marshal(m)
	if err != nil {
		return nil, fmt.Errorf("activity payload remarshal: %w", err)
	}
	return out, nil
}
