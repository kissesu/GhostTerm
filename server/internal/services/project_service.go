/*
@file project_service.go
@description ProjectService 的具体实现（Phase 5 Worker B）。

             覆盖 v2 修订集：
             - C3 — Create 事务原子化：INSERT projects + INSERT project_members
                    + INSERT status_change_logs(E0) + INSERT notifications 全部同事务，
                    任一失败 → tx 回滚 → 数据库无残留
             - C4 — E13 重启取消用快照精确还原：从 status_change_logs 最近一次 E12
                    读 from_status / from_holder_role_id / from_holder_user_id 还原项目
             - W9 — buildStatusUpdate 用列名白名单 + 9 个显式 case：在 statemachine 包内实现
                    （applyStateChange），本文件只调用

             业务背景：
             - 所有操作必须在 db.InTx + db.SetSessionContext 内执行，以激活 RLS（v2 part2 §W11+）
             - admin 不会被 RLS 阻挡（is_admin() helper 返回 true 时策略 USING TRUE）
             - 非 admin（CS / Dev）受 project_members 限制：必须是 owner / dev / viewer 才看得见
@author Atlas.oi
@date 2026-04-29
*/

package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ghostterm/progress-server/internal/api/oas"
	progressdb "github.com/ghostterm/progress-server/internal/db"
	"github.com/ghostterm/progress-server/internal/services/statemachine"
)

// ============================================================
// Sentinel errors
// ============================================================

var (
	// ErrProjectNotFound 项目不存在 / RLS 拦截看不见
	ErrProjectNotFound = errors.New("project: not found")
	// ErrProjectPermissionDenied 角色无权创建 / 修改项目
	ErrProjectPermissionDenied = errors.New("project: permission denied")
	// ErrProjectInvalidInput 入参缺失 / 非法
	ErrProjectInvalidInput = errors.New("project: invalid input")
	// ErrCancelPermissionDenied 用户无 progress:project:cancel 权限（拦截 E12/E13）
	// 业务背景（2026-05-04）：cancel 是破坏性操作，dev 默认无权
	ErrCancelPermissionDenied = errors.New("project: cancel permission denied")
)

// ============================================================
// 输入 / 输出 DTO（不与 oas.* 直接耦合，避免 service 反向依赖 handler）
// ============================================================

// CreateProjectInput 创建项目的入参。
//
// 业务背景：CustomerLabel 必填非空（自由文本）；金额（OriginalQuote）默认 0；priority/thesisLevel 可选。
// 用户需求修正 2026-04-30：客户从独立资源降级为 projects.customer_label 字段，
// 不再校验客户存在性，只要求字段非空。
type CreateProjectInput struct {
	Name          string
	CustomerLabel string
	Description   string
	Priority      oas.ProjectPriority // "" 表示未指定，DB 默认 'normal'
	ThesisLevel   *oas.ThesisLevel
	Subject       *string
	Deadline      time.Time
	OriginalQuote progressdb.Money // 默认 0；DB 列 NUMERIC(12,2) NOT NULL DEFAULT 0
	// 创建时关联的资料文件 ID（先 POST /api/files 上传后带入；nil 表示不关联）：
	OpeningDocID    *int64  // 开题书 → projects.opening_doc_id
	AssignmentDocID *int64  // 任务书 → projects.assignment_doc_id
	// 微信聊天记录截图文件 ID 数组；非空时事务内 INSERT N 行 project_files(category='wechat_chat')
	WechatChatFileIDs []int64
	// 项目对接的开发人员 user.id 数组（业务需求 2026-05-03）：
	// - 必填非空（handler 已校验 minItems:1）
	// - 事务内 INSERT 到 project_developers（用于 projects RLS 可见性）
	// - 同步 INSERT 到 project_members(role='dev')（让 dev 通过 is_member 看到子资源）
	DeveloperUserIDs []int64
}

// ProjectDeveloperRef 是项目对接开发人员的最小展示 DTO（id + 显示名）。
// handler 转 oas.ProjectDevelopersItem。
type ProjectDeveloperRef struct {
	ID          int64
	DisplayName string
}

// UpdateProjectInput 修改项目基础字段；nil 字段表示不变。
//
// 业务规则：
// - status / holder_* 不能通过 Update 改，只能通过 TriggerEvent 推进状态机
// - created_by 不可改（修正必须删除重建）
// - customer_label 允许 cs/admin 修改（仅文本字段更新）
type UpdateProjectInput struct {
	Name          *string
	CustomerLabel *string
	Description   *string
	Priority      *oas.ProjectPriority
	ThesisLevel   *oas.ThesisLevel
	Subject       *string // *string=nil 表示"不更新"；空指针指向空串表示"清空"
	ClearSubject  bool    // 单独的 clear flag 区分"不动"与"清空"
	Deadline      *time.Time
}

// ProjectModel 是 service 层返回的 DTO（与 DB 列对齐），handler 转 oas.Project。
type ProjectModel struct {
	ID              int64
	Name            string
	CustomerLabel   string
	Description     string
	Priority        oas.ProjectPriority
	ThesisLevel     *oas.ThesisLevel
	Subject         *string
	Status          oas.ProjectStatus
	HolderRoleID    *int64
	HolderUserID    *int64
	Deadline        time.Time
	QuotingAt       time.Time
	DevStartedAt    *time.Time
	ConfirmingAt    *time.Time
	DeliveredAt     *time.Time
	PaidAt          *time.Time
	ArchivedAt      *time.Time
	AfterSalesAt    *time.Time
	CancelledAt     *time.Time
	OriginalQuote   progressdb.Money
	CurrentQuote    progressdb.Money
	AfterSalesTotal progressdb.Money
	TotalReceived   progressdb.Money
	OpeningDocID    *int64
	AssignmentDocID *int64
	FormatSpecDocID *int64
	CreatedBy       int64
	CreatedAt       time.Time
	UpdatedAt       time.Time
	// Developers 项目对接的开发人员（List/Get 时填充；Create 后立即 reload 也会填充）。
	// 来源 project_developers JOIN users.display_name，jsonb_agg 聚合。
	Developers []ProjectDeveloperRef
}

// StatusChangeLogModel 是 ListStatusChanges 返回的 DTO。
type StatusChangeLogModel struct {
	ID                int64
	ProjectID         int64
	EventCode         string
	EventName         string
	FromStatus        *oas.ProjectStatus
	ToStatus          oas.ProjectStatus
	FromHolderRoleID  *int64
	ToHolderRoleID    *int64
	FromHolderUserID  *int64
	ToHolderUserID    *int64
	Remark            string
	TriggeredBy       int64
	TriggeredAt       time.Time
}

// ============================================================
// projectService 实现
// ============================================================

// ProjectServiceDeps 装配 NewProjectService 所需依赖。
type ProjectServiceDeps struct {
	Pool *pgxpool.Pool
}

// ProjectServiceImpl 是 ProjectService 的具体实现。
//
// 业务背景：导出该类型让 handler / 集成测试拿到具体方法集；interfaces.go 中的
// ProjectService 接口仍以 any 为入参占位，待 plan 后续 phase 统一收紧时再对齐。
type ProjectServiceImpl struct {
	pool *pgxpool.Pool
}

// NewProjectService 构造 ProjectService 具体实现。
//
// 业务背景：当前不接收 RBACService —— 端点级权限校验由 router middleware 完成；
// service 层只关心数据正确性 + RLS。
func NewProjectService(deps ProjectServiceDeps) (*ProjectServiceImpl, error) {
	if deps.Pool == nil {
		return nil, errors.New("project_service: pool is required")
	}
	return &ProjectServiceImpl{pool: deps.Pool}, nil
}

// ============================================================
// Create — C3 事务原子化
// ============================================================

// Create 创建项目，并把 owner/super-admin/dev 自动加入 project_members。
//
// 业务流程（C3 全部在同一事务内）：
//  1. 角色校验：仅 admin / cs 能创建（HasPermission 已在 handler 校；这里二次防御）
//  2. SetSessionContext：让 RLS / SECURITY DEFINER 函数读到当前身份
//  3. INSERT projects（status='quoting', holder=dev/firstDev, quoting_at=NOW(), original_quote=$.original）
//     2026-05-04 简化：删 dealing 状态后 E0 直接进 quoting；holder_user 取 in.DeveloperUserIDs[0]
//     让 first dev 直接接单报价；validateCreateInput 已强制 dev 至少 1 个
//  4. INSERT project_members：owner=creator + 全量 admin viewer + 指派 dev
//  5. statemachine.Execute(E0)：写 status_change_logs（quoting_at 已在 step 3 设置，
//     E0 对 enter ts 是幂等不变更）
//  6. INSERT notifications：球在 first dev 那里
//
// 任一步骤失败 → tx 回滚 → 0 残留。
func (s *ProjectServiceImpl) Create(
	ctx context.Context,
	creatorUserID, creatorRoleID int64,
	in CreateProjectInput,
) (*ProjectModel, error) {
	if err := validateCreateInput(in); err != nil {
		return nil, err
	}
	if creatorRoleID != statemachine.RoleAdmin && creatorRoleID != statemachine.RoleCS {
		return nil, fmt.Errorf("%w: only admin/cs can create projects (role=%d)",
			ErrProjectPermissionDenied, creatorRoleID)
	}

	var project *ProjectModel
	err := progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		// 注入 RLS GUC
		if err := progressdb.SetSessionContext(ctx, tx, creatorUserID, creatorRoleID); err != nil {
			return err
		}

		// 1) INSERT projects
		// priority 默认 'normal' 由 DB 处理（传 OptProjectPriority 空 → NULL → DEFAULT）
		priority := in.Priority
		if priority == "" {
			priority = oas.ProjectPriorityNormal
		}
		var thesisLevel any
		if in.ThesisLevel != nil {
			thesisLevel = string(*in.ThesisLevel)
		}
		var subject any
		if in.Subject != nil {
			subject = *in.Subject
		}
		// 资料文件 ID（NULL 兼容）：DB 列 BIGINT NULL，FK 到 files(id)
		var openingDocID, assignmentDocID any
		if in.OpeningDocID != nil {
			openingDocID = *in.OpeningDocID
		}
		if in.AssignmentDocID != nil {
			assignmentDocID = *in.AssignmentDocID
		}

		md, _ := RequestMetadataFrom(ctx)
		// INSERT projects RETURNING 最小必要列；2026-05-04 删 dealing 状态后直接进 quoting：
		// holder_user_id 取 first dev (validateCreateInput 已保证 >=1)，让 first dev 接单报价
		// 紧贴使用点二次防御 OOB（防止未来重排校验顺序时引入 panic）
		if len(in.DeveloperUserIDs) == 0 {
			return fmt.Errorf("%w: developerUserIds is required", ErrProjectInvalidInput)
		}
		firstDevUserID := in.DeveloperUserIDs[0]
		var (
			pID           int64
			pStatus       oas.ProjectStatus
			pHolderRoleID *int64
			pHolderUserID *int64
		)
		err := tx.QueryRow(ctx, `
			INSERT INTO projects (
				name, customer_label, description, priority, thesis_level, subject,
				status, holder_role_id, holder_user_id,
				deadline,
				original_quote, current_quote,
				opening_doc_id, assignment_doc_id,
				created_by,
				client_ip, user_agent
			) VALUES (
				$1, $2, $3, $4, $5, $6,
				'quoting', $7, $8,
				$9,
				$10, $10,
				$11, $12,
				$13,
				$14, $15
			)
			RETURNING id, status, holder_role_id, holder_user_id
		`,
			in.Name, in.CustomerLabel, in.Description, string(priority), thesisLevel, subject,
			statemachine.RoleDev, firstDevUserID,
			in.Deadline,
			in.OriginalQuote,
			openingDocID, assignmentDocID,
			creatorUserID,
			NullableIP(md.ClientIP), md.UserAgent,
		).Scan(&pID, &pStatus, &pHolderRoleID, &pHolderUserID)
		if err != nil {
			return fmt.Errorf("project_service.Create insert projects: %w", err)
		}

		// 2) INSERT project_developers（业务需求 2026-05-03）：
		// 项目对接的开发人员关系；service 层校验已确保 in.DeveloperUserIDs 非空。
		// 用 unnest 单语句批量插入；user_id 必须是 active dev (role_id=2)，否则报错。
		// 不在此处校验 role_id（DB 仅有 FK 到 users），由 handler/前端选择器保证只传 dev 用户。
		// 重复 ID 由 PRIMARY KEY 兜底，去重交给前端。
		if len(in.DeveloperUserIDs) > 0 {
			_, err = tx.Exec(ctx, `
				INSERT INTO project_developers (project_id, user_id)
				SELECT $1::bigint, uid
				FROM unnest($2::bigint[]) AS uid
				ON CONFLICT (project_id, user_id) DO NOTHING
			`, pID, in.DeveloperUserIDs)
			if err != nil {
				return fmt.Errorf("project_service.Create insert project_developers: %w", err)
			}
		}

		// 3) INSERT project_members
		// 业务规则（修订 2026-05-03）：
		//   - 创建者本人加 owner（用于 is_member 子资源 RLS）
		//   - 所有 active admin 加 viewer（超管始终能看到子资源）
		//   - 仅指派的 dev（in.DeveloperUserIDs）加 'dev' member（让 dev 通过 is_member 看到子资源）
		//
		// 与旧实现差异：不再把"所有 active dev"全量加入；未指派的 dev 不会进 project_members，
		// 也无法通过 is_member 看到子资源 —— 这正是新需求"开发只能看到自己对接的项目"。
		_, err = tx.Exec(ctx, `
			INSERT INTO project_members (project_id, user_id, role)
			SELECT $1::bigint, u.id, 'viewer'::project_member_role
			FROM users u WHERE u.is_active AND u.role_id = 1
			UNION ALL
			SELECT $1::bigint, $2::bigint, 'owner'::project_member_role
			UNION ALL
			SELECT $1::bigint, uid, 'dev'::project_member_role
			FROM unnest($3::bigint[]) AS uid
			ON CONFLICT (project_id, user_id) DO NOTHING
		`, pID, creatorUserID, in.DeveloperUserIDs)
		if err != nil {
			return fmt.Errorf("project_service.Create insert members: %w", err)
		}

		// 4) statemachine.Execute(E0)：写 status_change_logs
		// 注：2026-05-04 简化后 INSERT 直接 status='quoting' + holder=(dev,firstDev)；
		// applyStateChange 再写一次 quoting_at=NOW() 是幂等的（同一事务内时间一致）
		_, err = statemachine.Execute(ctx, tx, statemachine.ExecuteParams{
			Project: statemachine.ProjectSnapshot{
				ID:           pID,
				Status:       pStatus, // quoting
				HolderRoleID: pHolderRoleID,
				HolderUserID: pHolderUserID,
			},
			Event:           oas.EventCodeE0,
			Remark:          "项目创建",
			TriggeredByUser: creatorUserID,
			TriggeredByRole: creatorRoleID,
			ClientIP:        NullableIP(md.ClientIP),
			UserAgent:       md.UserAgent,
		})
		if err != nil {
			return fmt.Errorf("project_service.Create execute E0: %w", err)
		}

		// 5) INSERT notifications：按 EventTemplates[E0] 模板群发"项目已创建"
		//
		// 业务规则（用户需求 2026-05-03）：
		//   - 通知中心文案必须承载业务语义，不再使用"球在你这里"占位
		//   - 创建项目应通知所有指派开发"客服 X 创建了项目 Y, 需要开发报价"
		//
		// 注：此处先查 creator display_name —— project.created_by 即是 creatorUserID，
		// 但通知文案需要中文显示名，必须 JOIN users 表取出。
		var creatorName string
		if err := tx.QueryRow(ctx,
			`SELECT display_name FROM users WHERE id = $1`, creatorUserID,
		).Scan(&creatorName); err != nil {
			return fmt.Errorf("project_service.Create lookup creator name: %w", err)
		}
		notifyCtx := NotifyContext{
			ProjectID:        pID,
			ProjectName:      in.Name,
			ProjectDeadline:  in.Deadline,
			OriginalQuote:    in.OriginalQuote,
			CurrentQuote:     in.OriginalQuote,
			ActorUserID:      creatorUserID,
			ActorDisplayName: creatorName,
			ActorRoleID:      creatorRoleID,
			CreatorUserID:    creatorUserID,
			CreatorName:      creatorName,
			DeveloperUserIDs: in.DeveloperUserIDs,
			HolderUserID:     &creatorUserID,
			NewHolderUserID:  &creatorUserID,
			Remark:           "项目创建",
		}
		if err := dispatchEventNotifications(ctx, tx, oas.EventCodeE0, pID, notifyCtx); err != nil {
			return fmt.Errorf("project_service.Create notify: %w", err)
		}

		// 6) 微信聊天记录截图：逐个 INSERT project_files (category='wechat_chat')
		// 文件本身已由前端先 POST /api/files 上传（拿到 file_id 入 in.WechatChatFileIDs）；
		// 这里仅在事务内建立 project ↔ file 关联。任一失败 → 回滚保证 0 残留。
		for _, fileID := range in.WechatChatFileIDs {
			// added_by = creatorUserID：创建项目的用户即首批附件的添加者，
			// 用于 project_activity_view 的 actor 归属（migration 0006 起 NOT NULL）
			// + client_ip/user_agent 审计字段（migration 0008）
			_, err = tx.Exec(ctx, `
				INSERT INTO project_files (project_id, file_id, category, added_by, client_ip, user_agent)
				VALUES ($1, $2, 'wechat_chat', $3, $4, $5)
			`, pID, fileID, creatorUserID, NullableIP(md.ClientIP), md.UserAgent)
			if err != nil {
				return fmt.Errorf("project_service.Create insert wechat_chat file %d: %w", fileID, err)
			}
		}

		// 7) 重新加载完整 ProjectModel（含 developers jsonb 聚合）
		row := tx.QueryRow(ctx, projectSelectSQL+` WHERE p.id = $1`, pID)
		loaded, err := scanProject(row)
		if err != nil {
			return fmt.Errorf("project_service.Create reload: %w", err)
		}
		project = loaded
		return nil
	})
	if err != nil {
		return nil, err
	}
	return project, nil
}

// validateCreateInput 校验入参合法性。
func validateCreateInput(in CreateProjectInput) error {
	if in.Name == "" {
		return fmt.Errorf("%w: name is required", ErrProjectInvalidInput)
	}
	if in.CustomerLabel == "" {
		return fmt.Errorf("%w: customerLabel is required", ErrProjectInvalidInput)
	}
	if in.Description == "" {
		return fmt.Errorf("%w: description is required", ErrProjectInvalidInput)
	}
	if in.Deadline.IsZero() {
		return fmt.Errorf("%w: deadline is required", ErrProjectInvalidInput)
	}
	// 业务需求 2026-05-03：必须指派至少 1 个开发对接人
	if len(in.DeveloperUserIDs) == 0 {
		return fmt.Errorf("%w: developerUserIds is required (at least 1)", ErrProjectInvalidInput)
	}
	// finding #9：原始报价不能为负数（DB CHECK 兜底，但 service 层早拦避免事务失败信息泄漏）
	if in.OriginalQuote.Sign() < 0 {
		return fmt.Errorf("%w: originalQuote 不能为负数", ErrProjectInvalidInput)
	}
	return nil
}

// ============================================================
// List
// ============================================================

// List 列出当前用户能看到的项目（RLS 自动过滤 project_members）。
//
// 业务参数：
// - statusFilter == nil → 不按 status 过滤
func (s *ProjectServiceImpl) List(
	ctx context.Context,
	userID, roleID int64,
	statusFilter *oas.ProjectStatus,
) ([]*ProjectModel, error) {
	var out []*ProjectModel
	err := progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := progressdb.SetSessionContext(ctx, tx, userID, roleID); err != nil {
			return err
		}

		// 静态 SQL；status 过滤通过 NULL 短路（$1 IS NULL OR status=$1）
		// 复用 projectSelectSQL（含 developers jsonb 聚合子查询）
		var statusVal any
		if statusFilter != nil {
			statusVal = string(*statusFilter)
		}
		rows, err := tx.Query(ctx, projectSelectSQL+`
			WHERE ($1::project_status IS NULL OR p.status = $1::project_status)
			ORDER BY p.created_at DESC
		`, statusVal)
		if err != nil {
			return fmt.Errorf("project_service.List query: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			p, err := scanProject(rows)
			if err != nil {
				return err
			}
			out = append(out, p)
		}
		return rows.Err()
	})
	return out, err
}

// ============================================================
// Get
// ============================================================

// Get 单条查询；RLS 拦截 / 不存在统一返回 ErrProjectNotFound。
func (s *ProjectServiceImpl) Get(ctx context.Context, userID, roleID, projectID int64) (*ProjectModel, error) {
	var out *ProjectModel
	err := progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := progressdb.SetSessionContext(ctx, tx, userID, roleID); err != nil {
			return err
		}
		row := tx.QueryRow(ctx, projectSelectSQL+` WHERE p.id = $1`, projectID)
		p, err := scanProject(row)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrProjectNotFound
		}
		if err != nil {
			return err
		}
		out = p
		return nil
	})
	return out, err
}

// ============================================================
// Update — 仅基础字段（不含状态机）
// ============================================================

// Update 部分字段更新；只允许改 name / description / priority / thesis_level / subject / deadline。
func (s *ProjectServiceImpl) Update(
	ctx context.Context,
	userID, roleID, projectID int64,
	in UpdateProjectInput,
) (*ProjectModel, error) {
	var out *ProjectModel
	err := progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := progressdb.SetSessionContext(ctx, tx, userID, roleID); err != nil {
			return err
		}

		// 用 COALESCE 模式：传入 NULL 时保留原值；传入非 NULL 时更新。
		// subject 特殊：UpdateProjectInput.ClearSubject==true 表示"清空"
		var subjectArg any
		if in.ClearSubject {
			subjectArg = nil // 显式 NULL
		} else if in.Subject != nil {
			subjectArg = *in.Subject
		} else {
			subjectArg = "__NO_CHANGE__" // 哨兵值，下面 SQL 用 CASE 判断
		}

		// 拒绝 fmt.Sprintf 拼 SQL：用静态 SQL + COALESCE/CASE 分支
		var name, desc any
		if in.Name != nil {
			name = *in.Name
		}
		if in.Description != nil {
			desc = *in.Description
		}
		var priority any
		if in.Priority != nil {
			priority = string(*in.Priority)
		}
		var thesisLevel any
		if in.ThesisLevel != nil {
			thesisLevel = string(*in.ThesisLevel)
		}
		var deadline any
		if in.Deadline != nil {
			deadline = *in.Deadline
		}
		var customerLabel any
		if in.CustomerLabel != nil {
			customerLabel = *in.CustomerLabel
		}

		row := tx.QueryRow(ctx, `
			UPDATE projects SET
				name           = COALESCE($2, name),
				customer_label = COALESCE($8, customer_label),
				description    = COALESCE($3, description),
				priority       = COALESCE($4::project_priority, priority),
				thesis_level   = COALESCE($5::thesis_level, thesis_level),
				subject        = CASE
				                   WHEN $6::TEXT = '__NO_CHANGE__' THEN subject
				                   ELSE $6
				                 END,
				deadline       = COALESCE($7, deadline),
				updated_at     = NOW()
			WHERE id = $1
			RETURNING
				id, name, customer_label, description, priority, thesis_level, subject,
				status, holder_role_id, holder_user_id,
				deadline,
				quoting_at, dev_started_at, confirming_at,
				delivered_at, paid_at, archived_at, after_sales_at, cancelled_at,
				original_quote, current_quote, after_sales_total, total_received,
				opening_doc_id, assignment_doc_id, format_spec_doc_id,
				created_by, created_at, updated_at
		`, projectID, name, desc, priority, thesisLevel, subjectArg, deadline, customerLabel)

		p, err := scanProject(row)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrProjectNotFound
		}
		if err != nil {
			return fmt.Errorf("project_service.Update: %w", err)
		}
		out = p
		return nil
	})
	return out, err
}

// ============================================================
// TriggerEvent — 状态机入口（含 E12 快照 + E13 还原）
// ============================================================

// TriggerEvent 推进状态机事件；statemachine.Execute 已写日志，本函数附加 notifications。
//
// 业务流程：
//  1. SetSessionContext + SELECT FOR UPDATE 锁住项目
//  2. statemachine.Execute(event, snapshot, params)
//  3. INSERT notifications（如新 holder_user 不为 nil 且 ≠ 旧 holder_user，发 ball_passed）
//  4. 重新 SELECT 项目返回最新状态
func (s *ProjectServiceImpl) TriggerEvent(
	ctx context.Context,
	userID, roleID, projectID int64,
	event oas.EventCode,
	remark string,
	newHolderUserID *int64,
) (*ProjectModel, error) {
	var out *ProjectModel
	err := progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := progressdb.SetSessionContext(ctx, tx, userID, roleID); err != nil {
			return err
		}

		// 1. SELECT FOR UPDATE 拿当前快照
		var (
			curStatus       oas.ProjectStatus
			curHolderRoleID *int64
			curHolderUserID *int64
		)
		err := tx.QueryRow(ctx, `
			SELECT status, holder_role_id, holder_user_id
			FROM projects
			WHERE id = $1
			FOR UPDATE
		`, projectID).Scan(&curStatus, &curHolderRoleID, &curHolderUserID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrProjectNotFound
		}
		if err != nil {
			return fmt.Errorf("project_service.TriggerEvent select: %w", err)
		}

		// 2. statemachine.Execute（含 W9 白名单 UPDATE + INSERT 日志）
		md, _ := RequestMetadataFrom(ctx)
		result, err := statemachine.Execute(ctx, tx, statemachine.ExecuteParams{
			Project: statemachine.ProjectSnapshot{
				ID:           projectID,
				Status:       curStatus,
				HolderRoleID: curHolderRoleID,
				HolderUserID: curHolderUserID,
			},
			Event:           event,
			Remark:          remark,
			TriggeredByUser: userID,
			TriggeredByRole: roleID,
			NewHolderUserID: newHolderUserID,
			ClientIP:        NullableIP(md.ClientIP),
			UserAgent:       md.UserAgent,
		})
		if err != nil {
			return err
		}

		// 3. 通知：按 EventTemplates[event] 模板群发规范化文案
		//
		// 业务规则（用户需求 2026-05-03）：
		//   - 每个事件触发都必须推送通知，不只在 holder 切换时
		//   - 文案必须承载业务语义（金额、截止日、操作人）而非"球到你了"占位
		//   - 接收者由 EventTemplates[event].Recipients 决定（业务语义驱动）
		//
		// 拉取通知所需上下文：项目快照（金额/截止日/创建者）+ 触发者 display_name
		// + 全体对接开发 user_ids，一次 JOIN 查询满足。
		notifyCtx, err := loadNotifyContext(ctx, tx, projectID, userID, roleID, remark, result.NewHolderUserID)
		if err != nil {
			return fmt.Errorf("project_service.TriggerEvent load notify ctx: %w", err)
		}
		if err := dispatchEventNotifications(ctx, tx, event, projectID, notifyCtx); err != nil {
			return fmt.Errorf("project_service.TriggerEvent notify: %w", err)
		}

		// 4. 重新 SELECT 返回最新数据
		row := tx.QueryRow(ctx, projectSelectSQL+` WHERE p.id = $1`, projectID)
		p, err := scanProject(row)
		if err != nil {
			return fmt.Errorf("project_service.TriggerEvent reload: %w", err)
		}
		out = p
		return nil
	})
	return out, err
}

// ============================================================
// ListStatusChanges
// ============================================================

// ListStatusChanges 项目状态变更日志（按时间正序）。
func (s *ProjectServiceImpl) ListStatusChanges(
	ctx context.Context,
	userID, roleID, projectID int64,
) ([]*StatusChangeLogModel, error) {
	var out []*StatusChangeLogModel
	err := progressdb.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := progressdb.SetSessionContext(ctx, tx, userID, roleID); err != nil {
			return err
		}
		// 先校验项目可见性
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1)`, projectID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrProjectNotFound
		}

		rows, err := tx.Query(ctx, `
			SELECT
				id, project_id, event_code, event_name,
				from_status, to_status,
				from_holder_role_id, to_holder_role_id,
				from_holder_user_id, to_holder_user_id,
				remark, triggered_by, triggered_at
			FROM status_change_logs
			WHERE project_id = $1
			ORDER BY triggered_at ASC, id ASC
		`, projectID)
		if err != nil {
			return fmt.Errorf("project_service.ListStatusChanges: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var l StatusChangeLogModel
			if err := rows.Scan(
				&l.ID, &l.ProjectID, &l.EventCode, &l.EventName,
				&l.FromStatus, &l.ToStatus,
				&l.FromHolderRoleID, &l.ToHolderRoleID,
				&l.FromHolderUserID, &l.ToHolderUserID,
				&l.Remark, &l.TriggeredBy, &l.TriggeredAt,
			); err != nil {
				return fmt.Errorf("project_service.ListStatusChanges scan: %w", err)
			}
			out = append(out, &l)
		}
		return rows.Err()
	})
	return out, err
}

// ============================================================
// SQL helpers
// ============================================================

// projectSelectSQL 选出全部 project 字段（与 scanProject 一致）+ 嵌入 developers jsonb 聚合。
//
// 业务背景：把 SELECT 列固化在常量里，避免 List/Get/Update/TriggerEvent 各自 SELECT
// 出现列序漂移导致的 scan 错位。
//
// developers 列：LEFT JOIN project_developers + JOIN users，按 displayName 升序聚合
// 成 [{id, displayName}, ...]，COALESCE 保证空数组而非 NULL（前端 zod default([]) 仍兜底）。
// 参考记忆 feedback_pg_inet_host_func_view_jsonb_agg_payload。
const projectSelectSQL = `
	SELECT
		p.id, p.name, p.customer_label, p.description, p.priority, p.thesis_level, p.subject,
		p.status, p.holder_role_id, p.holder_user_id,
		p.deadline,
		p.quoting_at, p.dev_started_at, p.confirming_at,
		p.delivered_at, p.paid_at, p.archived_at, p.after_sales_at, p.cancelled_at,
		p.original_quote, p.current_quote, p.after_sales_total, p.total_received,
		p.opening_doc_id, p.assignment_doc_id, p.format_spec_doc_id,
		p.created_by, p.created_at, p.updated_at,
		COALESCE((
			SELECT jsonb_agg(jsonb_build_object('id', u.id, 'displayName', u.display_name) ORDER BY u.display_name)
			FROM project_developers pd
			JOIN users u ON u.id = pd.user_id
			WHERE pd.project_id = p.id
		), '[]'::jsonb) AS developers
	FROM projects p
`

// rowScanner 是 *pgx.Row / pgx.Rows 的最小公共面，用于复用 scanProject。
type rowScanner interface {
	Scan(dst ...any) error
}

// scanProject 把单行扫描成 ProjectModel。列序与 projectSelectSQL 严格对齐。
func scanProject(s rowScanner) (*ProjectModel, error) {
	var p ProjectModel
	var developersJSON []byte
	err := s.Scan(
		&p.ID, &p.Name, &p.CustomerLabel, &p.Description,
		&p.Priority, &p.ThesisLevel, &p.Subject,
		&p.Status, &p.HolderRoleID, &p.HolderUserID,
		&p.Deadline,
		&p.QuotingAt, &p.DevStartedAt, &p.ConfirmingAt,
		&p.DeliveredAt, &p.PaidAt, &p.ArchivedAt, &p.AfterSalesAt, &p.CancelledAt,
		&p.OriginalQuote, &p.CurrentQuote, &p.AfterSalesTotal, &p.TotalReceived,
		&p.OpeningDocID, &p.AssignmentDocID, &p.FormatSpecDocID,
		&p.CreatedBy, &p.CreatedAt, &p.UpdatedAt,
		&developersJSON,
	)
	if err != nil {
		return nil, err
	}
	if len(developersJSON) > 0 {
		// jsonb 反序列化：[{"id":..., "displayName":"..."}]
		// 用 json.Unmarshal 避免引第三方库；developers 列 COALESCE 兜底为 '[]'
		var raw []struct {
			ID          int64  `json:"id"`
			DisplayName string `json:"displayName"`
		}
		if err := json.Unmarshal(developersJSON, &raw); err != nil {
			return nil, fmt.Errorf("project_service.scanProject: parse developers jsonb: %w", err)
		}
		p.Developers = make([]ProjectDeveloperRef, 0, len(raw))
		for _, r := range raw {
			p.Developers = append(p.Developers, ProjectDeveloperRef{ID: r.ID, DisplayName: r.DisplayName})
		}
	}
	if p.Developers == nil {
		p.Developers = []ProjectDeveloperRef{}
	}
	return &p, nil
}
