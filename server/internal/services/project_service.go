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
	DealingAt       time.Time
	QuotingAt       *time.Time
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
//  3. INSERT projects（status='dealing', holder='cs', dealing_at=NOW(), original_quote=$.original）
//  4. INSERT project_members：owner=creator + 全量 admin viewer + 全量 dev
//  5. statemachine.Execute(E0)：写 status_change_logs（dealing_at 已在 step 3 设置，
//     E0 对 enter ts 是幂等不变更）
//  6. INSERT notifications：球在创建者那里
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

		var p ProjectModel
		err := tx.QueryRow(ctx, `
			INSERT INTO projects (
				name, customer_label, description, priority, thesis_level, subject,
				status, holder_role_id, holder_user_id,
				deadline,
				original_quote, current_quote,
				created_by
			) VALUES (
				$1, $2, $3, $4, $5, $6,
				'dealing', $7, $8,
				$9,
				$10, $10,
				$11
			)
			RETURNING
				id, name, customer_label, description, priority, thesis_level, subject,
				status, holder_role_id, holder_user_id,
				deadline,
				dealing_at, quoting_at, dev_started_at, confirming_at,
				delivered_at, paid_at, archived_at, after_sales_at, cancelled_at,
				original_quote, current_quote, after_sales_total, total_received,
				opening_doc_id, assignment_doc_id, format_spec_doc_id,
				created_by, created_at, updated_at
		`,
			in.Name, in.CustomerLabel, in.Description, string(priority), thesisLevel, subject,
			statemachine.RoleCS, creatorUserID,
			in.Deadline,
			in.OriginalQuote,
			creatorUserID,
		).Scan(
			&p.ID, &p.Name, &p.CustomerLabel, &p.Description,
			&p.Priority, &p.ThesisLevel, &p.Subject,
			&p.Status, &p.HolderRoleID, &p.HolderUserID,
			&p.Deadline,
			&p.DealingAt, &p.QuotingAt, &p.DevStartedAt, &p.ConfirmingAt,
			&p.DeliveredAt, &p.PaidAt, &p.ArchivedAt, &p.AfterSalesAt, &p.CancelledAt,
			&p.OriginalQuote, &p.CurrentQuote, &p.AfterSalesTotal, &p.TotalReceived,
			&p.OpeningDocID, &p.AssignmentDocID, &p.FormatSpecDocID,
			&p.CreatedBy, &p.CreatedAt, &p.UpdatedAt,
		)
		if err != nil {
			return fmt.Errorf("project_service.Create insert projects: %w", err)
		}

		// 2) INSERT project_members（owner + 全量 admin viewer + 全量 dev）
		// 业务规则（v2 §C2）：
		//   - 创建者本人加 owner
		//   - 所有 active admin 加 viewer（超管始终能看到）
		//   - 所有 active dev 加 dev（开发能看到所有项目以分配工作）
		// pgx 类型推导注：UNION ALL 时 $1 类型由第一行决定（CASE 让 pgx 推为 unknown→bigint
		// 在 OK 路径，但稳健做法是显式 ::bigint 强制类型，避免某些路径推成 text）。
		_, err = tx.Exec(ctx, `
			INSERT INTO project_members (project_id, user_id, role)
			SELECT $1::bigint, u.id,
				CASE u.role_id
					WHEN 1 THEN 'viewer'::project_member_role
					WHEN 2 THEN 'dev'::project_member_role
				END
			FROM users u WHERE u.is_active AND u.role_id IN (1, 2)
			UNION ALL
			SELECT $1::bigint, $2::bigint, 'owner'::project_member_role
			ON CONFLICT (project_id, user_id) DO NOTHING
		`, p.ID, creatorUserID)
		if err != nil {
			return fmt.Errorf("project_service.Create insert members: %w", err)
		}

		// 3) statemachine.Execute(E0)：写 status_change_logs
		// 注：dealing_at 已在 INSERT projects 时由 DB DEFAULT NOW() 设置；
		// applyStateChange 再写一次 dealing_at=NOW() 是幂等的（同一事务内时间一致）
		_, err = statemachine.Execute(ctx, tx, statemachine.ExecuteParams{
			Project: statemachine.ProjectSnapshot{
				ID:           p.ID,
				Status:       p.Status, // dealing
				HolderRoleID: p.HolderRoleID,
				HolderUserID: p.HolderUserID,
			},
			Event:           oas.EventCodeE0,
			Remark:          "项目创建",
			TriggeredByUser: creatorUserID,
			TriggeredByRole: creatorRoleID,
		})
		if err != nil {
			return fmt.Errorf("project_service.Create execute E0: %w", err)
		}

		// 4) INSERT notifications：球在创建者
		_, err = tx.Exec(ctx, `
			INSERT INTO notifications (user_id, type, project_id, title, body)
			VALUES ($1, 'ball_passed', $2, '球在你这里', '新项目 ' || $3 || ' 创建完成，等待洽谈')
		`, creatorUserID, p.ID, p.Name)
		if err != nil {
			return fmt.Errorf("project_service.Create insert notification: %w", err)
		}

		project = &p
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
		var statusVal any
		if statusFilter != nil {
			statusVal = string(*statusFilter)
		}
		rows, err := tx.Query(ctx, `
			SELECT
				id, name, customer_label, description, priority, thesis_level, subject,
				status, holder_role_id, holder_user_id,
				deadline,
				dealing_at, quoting_at, dev_started_at, confirming_at,
				delivered_at, paid_at, archived_at, after_sales_at, cancelled_at,
				original_quote, current_quote, after_sales_total, total_received,
				opening_doc_id, assignment_doc_id, format_spec_doc_id,
				created_by, created_at, updated_at
			FROM projects
			WHERE ($1::project_status IS NULL OR status = $1::project_status)
			ORDER BY created_at DESC
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
		row := tx.QueryRow(ctx, projectSelectSQL+` WHERE id = $1`, projectID)
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
				dealing_at, quoting_at, dev_started_at, confirming_at,
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
		})
		if err != nil {
			return err
		}

		// 3. 通知：新 holder_user 收"球在你这里"通知
		if result.NewHolderUserID != nil &&
			(curHolderUserID == nil || *result.NewHolderUserID != *curHolderUserID) {
			_, err = tx.Exec(ctx, `
				INSERT INTO notifications (user_id, type, project_id, title, body)
				VALUES ($1, 'ball_passed', $2, '球在你这里', $3)
			`, *result.NewHolderUserID, projectID,
				fmt.Sprintf("项目状态进入 %s（事件 %s）", result.NewStatus, event))
			if err != nil {
				return fmt.Errorf("project_service.TriggerEvent notify: %w", err)
			}
		}

		// 4. 重新 SELECT 返回最新数据
		row := tx.QueryRow(ctx, projectSelectSQL+` WHERE id = $1`, projectID)
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

// projectSelectSQL 选出全部 project 字段（与 scanProject 一致）。
//
// 业务背景：把 SELECT 列固化在常量里，避免 List/Get/Update/TriggerEvent 各自 SELECT
// 出现列序漂移导致的 scan 错位。
const projectSelectSQL = `
	SELECT
		id, name, customer_label, description, priority, thesis_level, subject,
		status, holder_role_id, holder_user_id,
		deadline,
		dealing_at, quoting_at, dev_started_at, confirming_at,
		delivered_at, paid_at, archived_at, after_sales_at, cancelled_at,
		original_quote, current_quote, after_sales_total, total_received,
		opening_doc_id, assignment_doc_id, format_spec_doc_id,
		created_by, created_at, updated_at
	FROM projects
`

// rowScanner 是 *pgx.Row / pgx.Rows 的最小公共面，用于复用 scanProject。
type rowScanner interface {
	Scan(dst ...any) error
}

// scanProject 把单行扫描成 ProjectModel。列序与 projectSelectSQL 严格对齐。
func scanProject(s rowScanner) (*ProjectModel, error) {
	var p ProjectModel
	err := s.Scan(
		&p.ID, &p.Name, &p.CustomerLabel, &p.Description,
		&p.Priority, &p.ThesisLevel, &p.Subject,
		&p.Status, &p.HolderRoleID, &p.HolderUserID,
		&p.Deadline,
		&p.DealingAt, &p.QuotingAt, &p.DevStartedAt, &p.ConfirmingAt,
		&p.DeliveredAt, &p.PaidAt, &p.ArchivedAt, &p.AfterSalesAt, &p.CancelledAt,
		&p.OriginalQuote, &p.CurrentQuote, &p.AfterSalesTotal, &p.TotalReceived,
		&p.OpeningDocID, &p.AssignmentDocID, &p.FormatSpecDocID,
		&p.CreatedBy, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &p, nil
}
