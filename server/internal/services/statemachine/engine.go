/*
@file engine.go
@description 状态机执行引擎：CanFire（前置校验）+ Execute（事务内推进）。

             覆盖点：
             - v2 part2 §W9：applyStateChange 用 9 个显式 case + 列名白名单（不用 fmt.Sprintf）
             - v2 part1 §C4：E12 取消时把"取消前快照"写入 from_holder_role_id / from_holder_user_id；
               E13 重启取消时从最近一次 E12 日志读出 from_* 精确还原
             - spec §6.2：每个事件都有 (allowed_role, from_status, from_holder, to_status, to_holder)
               的硬规则，CanFire 全部校验；admin 兜底放行（spec §6.2 备注）

             调用约定：
             - Execute 必须在调用方传入的 tx 内完成；不开新 tx，避免与 ProjectService 的
               "INSERT projects + INSERT members + INSERT log + INSERT notification" 同事务
             - Execute 不调 db.SetSessionContext —— 那是调用方的责任（service 层进 tx 时已注入）
             - 所有错误必须暴露给调用方，不做静默降级（"禁止降级回退"原则）
@author Atlas.oi
@date 2026-04-29
*/

package statemachine

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/ghostterm/progress-server/internal/api/oas"
)

// ============================================================
// Sentinel errors
// ============================================================

var (
	// ErrUnknownEvent: 事件码不在 Transitions 表中
	ErrUnknownEvent = errors.New("statemachine: unknown event")
	// ErrPermissionDenied: 当前 role 不在 AllowedRoleIDs 内（admin 已兜底放行）
	ErrPermissionDenied = errors.New("statemachine: role not allowed for event")
	// ErrInvalidStateTransition: 当前 status 不匹配 transition.From
	ErrInvalidStateTransition = errors.New("statemachine: invalid state transition")
	// ErrInvalidHolder: 当前 holder_role 不匹配 transition.FromHolderRole
	ErrInvalidHolder = errors.New("statemachine: invalid holder for event")
	// ErrRemarkRequired: transition 要求 remark 必填但 caller 传空串
	ErrRemarkRequired = errors.New("statemachine: remark required")
	// ErrNoCancelHistory: E13 但项目从未被 E12 取消过（没有快照可还原）
	ErrNoCancelHistory = errors.New("statemachine: no cancel history to restore")
	// ErrInvalidEnterTSColumn: applyStateChange 收到的列名不在白名单（防御 SQL 注入）
	ErrInvalidEnterTSColumn = errors.New("statemachine: enter ts column not allowed")
)

// ============================================================
// CanFire — 纯逻辑前置校验（无 DB 副作用）
// ============================================================

// ProjectSnapshot 是 CanFire / Execute 的入参快照。
//
// 业务背景：拒绝把 *models.Project 大对象塞进来 —— 状态机只关心 (status, holder_role, holder_user)
// 三个字段，单独封一个轻 struct 让单测构造数据更廉价。
type ProjectSnapshot struct {
	ID           int64
	Status       ProjectStatus
	HolderRoleID *int64
	HolderUserID *int64
}

// CanFire 校验 (project, event, userRole) 三元组是否合法。
//
// 业务流程：
//  1. 找 transition；不存在 → ErrUnknownEvent
//  2. 角色校验：
//     - admin (RoleAdmin) 兜底放行（spec §6.2 备注）
//     - 否则 userRole 必须 ∈ AllowedRoleIDs
//  3. From 校验：
//     - transition.From == ""（E0 创建 / E12 通配） → 跳过 status 比对
//     - 否则 project.Status 必须等于 transition.From
//  4. FromHolderRole 校验：
//     - transition.FromHolderRole == nil → 跳过
//     - 否则 project.HolderRoleID 必须等于（admin 兜底已在 2 处理）
//
// 设计取舍：
//   - 不校验 remark 是否为空 —— 那是 service 层的职责（service 在调 Execute 前 validate 入参）
//   - 不验 project_members（"是否成员"） —— 那是 RBAC 层的职责
func CanFire(project ProjectSnapshot, event EventCode, userRole int64) error {
	t, ok := FindTransition(event)
	if !ok {
		return fmt.Errorf("%w: %s", ErrUnknownEvent, event)
	}

	// 角色：admin 兜底放行
	if userRole != RoleAdmin {
		allowed := false
		for _, r := range t.AllowedRoleIDs {
			if r == userRole {
				allowed = true
				break
			}
		}
		if !allowed {
			return fmt.Errorf("%w: role=%d event=%s", ErrPermissionDenied, userRole, event)
		}
	}

	// From status：空串 = 通配（E0 创建 / E12 通配任意非终态）
	if t.From != "" {
		if project.Status != t.From {
			return fmt.Errorf("%w: have=%s want=%s event=%s",
				ErrInvalidStateTransition, project.Status, t.From, event)
		}
	} else if event == oas.EventCodeE12 {
		// E12 特殊：From="" 但禁止从 cancelled / archived 再取消
		// 业务规则（spec §6.2）："任意非终态"才能取消
		if project.Status == oas.ProjectStatusCancelled || project.Status == oas.ProjectStatusArchived {
			return fmt.Errorf("%w: cannot cancel from terminal status %s",
				ErrInvalidStateTransition, project.Status)
		}
	}

	// FromHolderRole：admin 不受限（其它路径仍按规则）
	if t.FromHolderRole != nil && userRole != RoleAdmin {
		if project.HolderRoleID == nil || *project.HolderRoleID != *t.FromHolderRole {
			have := int64(-1)
			if project.HolderRoleID != nil {
				have = *project.HolderRoleID
			}
			return fmt.Errorf("%w: have=%d want=%d event=%s",
				ErrInvalidHolder, have, *t.FromHolderRole, event)
		}
	}

	return nil
}

// ============================================================
// Execute — 事务内执行：UPDATE projects + INSERT status_change_logs
// ============================================================

// ExecuteParams 是 Execute 的入参打包。
//
// 业务背景：参数较多，单独 struct 让 caller 站点更清楚；同时方便 future 加字段不破坏 API。
type ExecuteParams struct {
	Project          ProjectSnapshot // 当前项目快照（事务内 SELECT FOR UPDATE 后传入）
	Event            EventCode       // 事件码
	Remark           string          // 状态变更日志备注（spec §6.2 大多必填）
	TriggeredByUser  int64           // 触发者 user_id（写入 status_change_logs.triggered_by）
	TriggeredByRole  int64           // 触发者 role_id（用于 CanFire 复检）
	NewHolderUserID  *int64          // 新持球者 user_id（事件需要切换持球者时；如 E2/E4/E7 等）
}

// ExecuteResult 是 Execute 的返回。
//
// 业务背景：service 层需要新状态构造 notifications + 返回 ProjectResponse，
// 因此 Execute 必须把"推进后的 (status, holder_role, holder_user)"明确返回给上层。
type ExecuteResult struct {
	NewStatus       ProjectStatus
	NewHolderRoleID *int64
	NewHolderUserID *int64
	Description     string // event 中文名（写日志用）
}

// Execute 在事务 tx 内推进项目状态。
//
// 业务流程：
//  1. CanFire 复校验（防止 service 层调用方漏调）
//  2. transition.RequiresRemark 时校验 remark 非空
//  3. 计算新 (status, holder_role, holder_user)：
//     - 大多数事件直接取 transition.To / ToHolderRole
//     - 新 holder_user_id：caller 传 NewHolderUserID 优先；否则保留 project.HolderUserID
//       （E12 终态强制清空；E13 由快照决定）
//     - E13 特殊：从 status_change_logs 读最近一次 E12 的 from_* 还原
//  4. applyStateChange：W9 白名单 + 9 个显式 case 动态选 SQL
//  5. INSERT status_change_logs（含完整 from_* / to_* 快照，C4 要求）
//
// 调用方责任：
//   - 已在外层 BEGIN tx 并 SetSessionContext
//   - 已 SELECT FOR UPDATE 拿到 project（避免并发触发同事件）
//   - Execute 返回成功后，由 caller 决定是否 INSERT notifications 等额外副作用
func Execute(ctx context.Context, tx pgx.Tx, params ExecuteParams) (ExecuteResult, error) {
	if tx == nil {
		return ExecuteResult{}, errors.New("statemachine: tx required")
	}

	t, ok := FindTransition(params.Event)
	if !ok {
		return ExecuteResult{}, fmt.Errorf("%w: %s", ErrUnknownEvent, params.Event)
	}

	// 1. CanFire 复校验（spec 安全要求：service 层调用前已查过一次，这里二次防御）
	if err := CanFire(params.Project, params.Event, params.TriggeredByRole); err != nil {
		return ExecuteResult{}, err
	}

	// 2. Remark 校验
	if t.RequiresRemark && params.Remark == "" {
		return ExecuteResult{}, fmt.Errorf("%w: event=%s", ErrRemarkRequired, params.Event)
	}

	// 3. 计算新状态 / holder
	var (
		newStatus       ProjectStatus
		newHolderRoleID *int64
		newHolderUserID *int64
		enterTSColumn   string
		desc            string = t.Description
	)

	switch params.Event {
	case oas.EventCodeE13:
		// E13 重启取消：读最近一次 E12 日志中的 from_* 精确还原
		var (
			fromStatus       ProjectStatus
			fromHolderRoleID *int64
			fromHolderUserID *int64
		)
		err := tx.QueryRow(ctx, `
			SELECT from_status, from_holder_role_id, from_holder_user_id
			FROM status_change_logs
			WHERE project_id = $1 AND event_code = 'E12'
			ORDER BY triggered_at DESC
			LIMIT 1
		`, params.Project.ID).Scan(&fromStatus, &fromHolderRoleID, &fromHolderUserID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ExecuteResult{}, ErrNoCancelHistory
		}
		if err != nil {
			return ExecuteResult{}, fmt.Errorf("statemachine: read E12 snapshot: %w", err)
		}
		newStatus = fromStatus
		newHolderRoleID = fromHolderRoleID
		newHolderUserID = fromHolderUserID
		enterTSColumn = EnterTSColumnForStatus(fromStatus)
		if enterTSColumn == "" {
			return ExecuteResult{}, fmt.Errorf("%w: snapshot status %s has no enter ts column",
				ErrInvalidEnterTSColumn, fromStatus)
		}
	default:
		// 通用路径
		newStatus = t.To
		if t.ToHolderRole != nil {
			roleID := *t.ToHolderRole
			newHolderRoleID = &roleID
		}
		// 新 holder user：caller 传 NewHolderUserID 优先（E2 由 admin 指定开发等）；
		// 否则保留 project.HolderUserID（同角色内换状态时不变）；
		// 终态 (cancelled/archived) 强制清空 user
		if t.ToHolderRole == nil {
			newHolderUserID = nil
		} else if params.NewHolderUserID != nil {
			newHolderUserID = params.NewHolderUserID
		} else {
			newHolderUserID = params.Project.HolderUserID
		}
		enterTSColumn = t.EnterTSColumn
	}

	// 4. UPDATE projects（W9 白名单 + 9 个显式 case）
	if err := applyStateChange(ctx, tx, params.Project.ID, newStatus, newHolderRoleID, newHolderUserID, enterTSColumn); err != nil {
		return ExecuteResult{}, err
	}

	// 5. INSERT status_change_logs（C4：完整 from/to 快照）
	//    E12 特殊：from_holder_* 取自 project（取消前的 role/user），to_* 都 nil
	//    E13 特殊：from_status='cancelled', to_status=newStatus, to_holder_*=newHolder*
	//    其它：通用 from/to 配对
	fromStatusVal := nullableStatus(params.Project.Status)
	if params.Event == oas.EventCodeE0 {
		// E0 创建：from_status=NULL（项目从无到有）
		fromStatusVal = nil
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO status_change_logs
		  (project_id, event_code, event_name,
		   from_status, to_status,
		   from_holder_role_id, to_holder_role_id,
		   from_holder_user_id, to_holder_user_id,
		   remark, triggered_by)
		VALUES
		  ($1, $2, $3,
		   $4, $5,
		   $6, $7,
		   $8, $9,
		   $10, $11)
	`,
		params.Project.ID, string(params.Event), desc,
		fromStatusVal, string(newStatus),
		params.Project.HolderRoleID, newHolderRoleID,
		params.Project.HolderUserID, newHolderUserID,
		params.Remark, params.TriggeredByUser,
	)
	if err != nil {
		return ExecuteResult{}, fmt.Errorf("statemachine: insert status_change_log: %w", err)
	}

	return ExecuteResult{
		NewStatus:       newStatus,
		NewHolderRoleID: newHolderRoleID,
		NewHolderUserID: newHolderUserID,
		Description:     desc,
	}, nil
}

// nullableStatus 把 ProjectStatus 转成 driver.Value（空串 → NULL）。
//
// 业务背景：pgx 直接传 ProjectStatus("") 会写入 enum 的空值（PG 拒绝），
// 必须显式转 nil 让 PG 写 NULL。
func nullableStatus(s ProjectStatus) any {
	if s == "" {
		return nil
	}
	return string(s)
}

// ============================================================
// applyStateChange — W9 白名单 + 9 个显式 case
// ============================================================

// applyStateChange 在 tx 内 UPDATE projects 推进状态。
//
// 安全要求（v2 part2 §W9）：
//   - 列名必须来自白名单（AllowedEnterTSColumns）；不在白名单一律报错
//   - 9 个显式 case，每个 case 的 SQL 字面量都是常量字符串（编译期可审计）
//   - 所有变量值通过 $N 参数传入，pgx 自动 escape，杜绝 SQL 注入
//
// 为什么不用 fmt.Sprintf：
//   - Sprintf 注入路径：哪天 Transitions 表被改坏（或测试代码越权写入恶意值）
//     → fmt.Sprintf("UPDATE projects SET %s = NOW() ...", attackerColumn) 直接执行
//   - 显式 case 写法：列名是 Go 源码字面量，攻击者要改 Go 源码才能改字面量，
//     PR review 必然抓到
func applyStateChange(
	ctx context.Context,
	tx pgx.Tx,
	projectID int64,
	newStatus ProjectStatus,
	newHolderRoleID, newHolderUserID *int64,
	enterTSColumn string,
) error {
	if !AllowedEnterTSColumns[enterTSColumn] {
		return fmt.Errorf("%w: %q", ErrInvalidEnterTSColumn, enterTSColumn)
	}

	// 9 个显式 case；每条 SQL 的列名都是常量字面量（grep-friendly + audit-friendly）
	var query string
	switch enterTSColumn {
	case "dealing_at":
		query = `UPDATE projects SET status=$1, holder_role_id=$2, holder_user_id=$3, dealing_at=NOW(), updated_at=NOW() WHERE id=$4`
	case "quoting_at":
		query = `UPDATE projects SET status=$1, holder_role_id=$2, holder_user_id=$3, quoting_at=NOW(), updated_at=NOW() WHERE id=$4`
	case "dev_started_at":
		query = `UPDATE projects SET status=$1, holder_role_id=$2, holder_user_id=$3, dev_started_at=NOW(), updated_at=NOW() WHERE id=$4`
	case "confirming_at":
		query = `UPDATE projects SET status=$1, holder_role_id=$2, holder_user_id=$3, confirming_at=NOW(), updated_at=NOW() WHERE id=$4`
	case "delivered_at":
		query = `UPDATE projects SET status=$1, holder_role_id=$2, holder_user_id=$3, delivered_at=NOW(), updated_at=NOW() WHERE id=$4`
	case "paid_at":
		query = `UPDATE projects SET status=$1, holder_role_id=$2, holder_user_id=$3, paid_at=NOW(), updated_at=NOW() WHERE id=$4`
	case "archived_at":
		query = `UPDATE projects SET status=$1, holder_role_id=$2, holder_user_id=$3, archived_at=NOW(), updated_at=NOW() WHERE id=$4`
	case "after_sales_at":
		query = `UPDATE projects SET status=$1, holder_role_id=$2, holder_user_id=$3, after_sales_at=NOW(), updated_at=NOW() WHERE id=$4`
	case "cancelled_at":
		query = `UPDATE projects SET status=$1, holder_role_id=$2, holder_user_id=$3, cancelled_at=NOW(), updated_at=NOW() WHERE id=$4`
	default:
		// 不可达（已通过白名单校验），但保留 default 让漏 case 在编译/测试期暴露
		return fmt.Errorf("%w: unreachable %q", ErrInvalidEnterTSColumn, enterTSColumn)
	}

	tag, err := tx.Exec(ctx, query, string(newStatus), newHolderRoleID, newHolderUserID, projectID)
	if err != nil {
		return fmt.Errorf("statemachine: apply state change: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// project 已被删 / id 错 / RLS 拦截 → 视为非法状态推进
		return fmt.Errorf("statemachine: project not updated (id=%d)", projectID)
	}
	return nil
}
