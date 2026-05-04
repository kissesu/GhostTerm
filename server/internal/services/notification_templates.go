/*
@file notification_templates.go
@description 16 事件通知文案模板表（业务需求 2026-05-03）。

	   业务背景（用户原话 2026-05-03）：
	   - 通知中心展示"球到你了"等通用占位文案，缺乏业务语义
	   - 每个事件触发都必须推送通知，且文案要承载业务语义
	     · 创建项目 → "客服 X 创建了项目 Y, 需要开发报价"
	     · 提交报价 → "开发 X 为项目 Y 报价 ¥Z"
	     · 接受报价 → "项目 X 接受 ¥Y 报价, 截止 ..., 开发请及时推进项目开发"

	设计取舍：
	1. 中心化模板：所有 16 个事件（E0/E1..E13/E_AS1/E_AS3）的 title/body 文案
	   集中维护在本文件，避免散落在 service 层多处硬编码（旧实现：project_service.go
	   两处硬编码 "球在你这里" / "项目状态进入 X（事件 Y）"）。
	2. 接收者函数化：Recipients 是函数而非静态列表，因为不同事件的"应通知人"
	   依赖 project 实时快照（创建者 / 持球者 / 全体开发等）；函数签名统一接受
	   NotifyContext 让 caller 一次性传入项目当前状态 + 触发者 + 新持球者等。
	3. 接收者去触发者本人：用户刚做完操作不需要再被自己通知；通用过滤在 Recipients 内做。
	4. 不扩 NotificationType：所有 16 事件一律用 ball_passed（通知本质 = 流程推进），
	   业务语义靠 title/body 文本承载。新加 type 需要同步 DB enum / OAS / 白名单
	   三处（feedback_db_check_enum_sync_three_places），权衡后不值。

@author Atlas.oi
@date 2026-05-03
*/
package services

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ghostterm/progress-server/internal/api/oas"
	progressdb "github.com/ghostterm/progress-server/internal/db"
)

// NotifyContext 是通知模板渲染的输入快照。
//
// 业务背景：
//   - ProjectName / ProjectDeadline / OriginalQuote / CurrentQuote 等来自 project 行
//   - ActorDisplayName / ActorRoleID 来自触发者（创建者或事件触发者）
//   - DeveloperUserIDs 来自 project_developers（全体对接开发，用于群发通知）
//   - NewHolderUserID 来自 statemachine 计算结果（事件后的持球者）
//   - Remark 来自 caller（事件备注，部分事件文案会引用）
type NotifyContext struct {
	ProjectID         int64
	ProjectName       string
	ProjectDeadline   time.Time
	OriginalQuote     progressdb.Money
	CurrentQuote      progressdb.Money
	AfterSalesTotal   progressdb.Money
	TotalReceived     progressdb.Money
	ActorUserID       int64
	ActorDisplayName  string
	ActorRoleID       int64
	CreatorUserID     int64        // project.created_by；恒为客服
	CreatorName       string       // 创建者 display_name（用于"客服 X"文案）
	DeveloperUserIDs  []int64      // 项目对接的全体开发 user_id
	HolderUserID      *int64       // 当前（事件前）持球者
	NewHolderUserID   *int64       // 事件后持球者（statemachine.Execute 返回）
	Remark            string
}

// NotifyTemplate 描述一个事件的通知文案 + 接收者计算策略。
//
// 业务规则：
//   - Title ≤ 16 个汉字，UI 列表行只显示一行不换行
//   - Body 详细说明业务动作 + 关键数据（金额 / 截止日 / 操作人）
//   - Recipients 返回应该收到通知的 user_id 列表（去重 + 去触发者本人由 caller 处理）
type NotifyTemplate struct {
	Title      func(c NotifyContext) string
	Body       func(c NotifyContext) string
	Recipients func(c NotifyContext) []int64
}

// formatMoney 把 Money 转成"¥1,234.56"格式（不带千分位简化版："¥1234.56"）。
//
// 业务背景：通知文案展示金额必须带 ¥ 符号 + 2 位小数；
// 不加千分位是为了 ASCII 字段长度可预期（短信/IM 兼容）。
func formatMoney(m progressdb.Money) string {
	return "¥" + m.StringFixed(2)
}

// formatDeadline 把 deadline 转成"2026年05月10日"中文格式。
//
// 业务背景：通知文案展示日期更直观，避免 ISO8601 含 T/Z 的技术感。
func formatDeadline(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format("2006年01月02日")
}

// roleLabel 把 role_id 翻译成中文角色名（用于"客服 X"/"开发 X"等文案）。
func roleLabel(roleID int64) string {
	switch roleID {
	case 1:
		return "管理员"
	case 2:
		return "开发"
	case 3:
		return "客服"
	}
	return "用户"
}

// EventTemplates 是 16 事件的通知模板字典（业务需求 2026-05-03）。
//
// 接收者策略总览（spec §6.2 + 业务需求）：
//   - E0 创建项目         → 全体对接开发（让开发知晓有新项目要报价）
//   - E1 提交报价评估     → 创建者（让客服知道开发开始报价了）
//   - E2 评估完成回传     → 创建者（让客服收到报价金额）
//   - E3 再问开发         → 全体对接开发（让开发处理客服追问）
//   - E4 客户接受报价     → 全体对接开发（让开发开始按时推进）
//   - E5 客户拒绝报价     → 全体对接开发（让开发知晓项目终止）
//   - E6 重新洽谈         → 创建者（球切回客服）
//   - E7 开发完成         → 创建者（让客服联系客户验收）
//   - E8 客户要修改       → 全体对接开发（让开发回到 dev）
//   - E9 客户验收通过     → 创建者（让客服跟进收款）
//   - E10 确认收款        → 全体对接开发 + 创建者（让所有人知晓款已到）
//   - E11 归档            → 全体对接开发 + 创建者
//   - E12 取消            → 全体对接开发 + 创建者（项目终止全员可见）
//   - E13 重启取消        → 还原后的持球者（由 NewHolderUserID 决定）
//   - E_AS1 客户报售后    → 全体对接开发 + 创建者
//   - E_AS3 售后已结束    → 全体对接开发 + 创建者
//
// 不通知触发者本人（在 caller 端用 dedupRecipients 过滤）。
var EventTemplates = map[oas.EventCode]NotifyTemplate{
	oas.EventCodeE0: {
		Title: func(c NotifyContext) string { return "项目已创建" },
		Body: func(c NotifyContext) string {
			return fmt.Sprintf("客服 %s 创建了项目「%s」，请开发尽快进行报价评估", c.CreatorName, c.ProjectName)
		},
		Recipients: func(c NotifyContext) []int64 {
			// 通知所有指派开发；创建者本人由后端默认 ball_passed 不再单独通知
			return c.DeveloperUserIDs
		},
	},
	oas.EventCodeE1: {
		Title: func(c NotifyContext) string { return "已转开发评估" },
		Body: func(c NotifyContext) string {
			return fmt.Sprintf("客服 %s 已将项目「%s」转交开发评估报价，请及时跟进",
				c.ActorDisplayName, c.ProjectName)
		},
		Recipients: func(c NotifyContext) []int64 {
			// 球转给开发：通知全体对接开发
			return c.DeveloperUserIDs
		},
	},
	oas.EventCodeE2: {
		Title: func(c NotifyContext) string { return "开发已报价" },
		Body: func(c NotifyContext) string {
			return fmt.Sprintf("开发 %s 为项目「%s」报价 %s，请客服与客户确认",
				c.ActorDisplayName, c.ProjectName, formatMoney(c.CurrentQuote))
		},
		Recipients: func(c NotifyContext) []int64 {
			// 报价回传 → 球到客服创建者
			return []int64{c.CreatorUserID}
		},
	},
	oas.EventCodeE3: {
		Title: func(c NotifyContext) string { return "客服追问报价" },
		Body: func(c NotifyContext) string {
			return fmt.Sprintf("客服 %s 就项目「%s」再次询问开发，请开发查看追问内容并回复",
				c.ActorDisplayName, c.ProjectName)
		},
		Recipients: func(c NotifyContext) []int64 {
			// 球转给开发：通知全体对接开发
			return c.DeveloperUserIDs
		},
	},
	oas.EventCodeE4: {
		Title: func(c NotifyContext) string { return "客户接受报价" },
		Body: func(c NotifyContext) string {
			deadline := formatDeadline(c.ProjectDeadline)
			return fmt.Sprintf("项目「%s」客户已接受 %s 报价，截止 %s，开发请及时推进开发",
				c.ProjectName, formatMoney(c.CurrentQuote), deadline)
		},
		Recipients: func(c NotifyContext) []int64 {
			// 客户接受 → 进入开发阶段；通知全体对接开发
			return c.DeveloperUserIDs
		},
	},
	oas.EventCodeE5: {
		Title: func(c NotifyContext) string { return "客户拒绝报价" },
		Body: func(c NotifyContext) string {
			return fmt.Sprintf("项目「%s」客户拒绝报价，项目已终止。备注：%s",
				c.ProjectName, fallbackRemark(c.Remark))
		},
		Recipients: func(c NotifyContext) []int64 {
			// 项目终止 → 通知全体对接开发知晓
			return c.DeveloperUserIDs
		},
	},
	oas.EventCodeE6: {
		Title: func(c NotifyContext) string { return "回到洽谈" },
		Body: func(c NotifyContext) string {
			return fmt.Sprintf("项目「%s」回到洽谈阶段，客服请重新与客户沟通",
				c.ProjectName)
		},
		Recipients: func(c NotifyContext) []int64 {
			// 球切回客服创建者
			return []int64{c.CreatorUserID}
		},
	},
	oas.EventCodeE7: {
		Title: func(c NotifyContext) string { return "开发已完成" },
		Body: func(c NotifyContext) string {
			return fmt.Sprintf("开发 %s 已完成项目「%s」，请客服联系客户进行验收",
				c.ActorDisplayName, c.ProjectName)
		},
		Recipients: func(c NotifyContext) []int64 {
			// 通知客服创建者
			return []int64{c.CreatorUserID}
		},
	},
	oas.EventCodeE8: {
		Title: func(c NotifyContext) string { return "客户要求修改" },
		Body: func(c NotifyContext) string {
			return fmt.Sprintf("项目「%s」客户要求修改，请开发查看备注并继续推进。备注：%s",
				c.ProjectName, fallbackRemark(c.Remark))
		},
		Recipients: func(c NotifyContext) []int64 {
			// 球切回开发：通知全体对接开发
			return c.DeveloperUserIDs
		},
	},
	oas.EventCodeE9: {
		Title: func(c NotifyContext) string { return "客户验收通过" },
		Body: func(c NotifyContext) string {
			return fmt.Sprintf("项目「%s」客户已验收通过 %s，请客服尽快跟进收款",
				c.ProjectName, formatMoney(c.CurrentQuote))
		},
		Recipients: func(c NotifyContext) []int64 {
			// 通知客服创建者
			return []int64{c.CreatorUserID}
		},
	},
	oas.EventCodeE10: {
		Title: func(c NotifyContext) string { return "项目已收款" },
		Body: func(c NotifyContext) string {
			return fmt.Sprintf("客服 %s 已确认收款 %s（项目「%s」）",
				c.ActorDisplayName, formatMoney(c.CurrentQuote), c.ProjectName)
		},
		Recipients: func(c NotifyContext) []int64 {
			// 收款 → 通知全体对接开发 + 创建者
			return mergeUserIDs(c.DeveloperUserIDs, []int64{c.CreatorUserID})
		},
	},
	oas.EventCodeE11: {
		Title: func(c NotifyContext) string { return "项目已归档" },
		Body: func(c NotifyContext) string {
			return fmt.Sprintf("项目「%s」已归档，全流程结束", c.ProjectName)
		},
		Recipients: func(c NotifyContext) []int64 {
			// 归档 → 通知全体对接开发 + 创建者
			return mergeUserIDs(c.DeveloperUserIDs, []int64{c.CreatorUserID})
		},
	},
	oas.EventCodeE12: {
		Title: func(c NotifyContext) string { return "项目已取消" },
		Body: func(c NotifyContext) string {
			return fmt.Sprintf("项目「%s」已被取消。备注：%s",
				c.ProjectName, fallbackRemark(c.Remark))
		},
		Recipients: func(c NotifyContext) []int64 {
			// 取消 → 通知全体对接开发 + 创建者
			return mergeUserIDs(c.DeveloperUserIDs, []int64{c.CreatorUserID})
		},
	},
	oas.EventCodeE13: {
		Title: func(c NotifyContext) string { return "项目已重启" },
		Body: func(c NotifyContext) string {
			return fmt.Sprintf("项目「%s」已重启，恢复至取消前的进度，请相关人员继续推进",
				c.ProjectName)
		},
		Recipients: func(c NotifyContext) []int64 {
			// 重启 → 通知还原后的持球者 + 全体对接开发 + 创建者（确保至少有一人接到球）
			recipients := mergeUserIDs(c.DeveloperUserIDs, []int64{c.CreatorUserID})
			if c.NewHolderUserID != nil {
				recipients = mergeUserIDs(recipients, []int64{*c.NewHolderUserID})
			}
			return recipients
		},
	},
	oas.EventCodeEAS1: {
		Title: func(c NotifyContext) string { return "客户报售后" },
		Body: func(c NotifyContext) string {
			return fmt.Sprintf("项目「%s」客户报售后，请客服跟进。备注：%s",
				c.ProjectName, fallbackRemark(c.Remark))
		},
		Recipients: func(c NotifyContext) []int64 {
			// 售后开始 → 通知全体对接开发 + 创建者
			return mergeUserIDs(c.DeveloperUserIDs, []int64{c.CreatorUserID})
		},
	},
	oas.EventCodeEAS3: {
		Title: func(c NotifyContext) string { return "售后已结束" },
		Body: func(c NotifyContext) string {
			return fmt.Sprintf("项目「%s」售后流程已结束，重新归档", c.ProjectName)
		},
		Recipients: func(c NotifyContext) []int64 {
			// 售后结束 → 通知全体对接开发 + 创建者
			return mergeUserIDs(c.DeveloperUserIDs, []int64{c.CreatorUserID})
		},
	},
}

// fallbackRemark 当 remark 为空串时返回"无"，避免文案出现"备注："悬空。
func fallbackRemark(remark string) string {
	r := strings.TrimSpace(remark)
	if r == "" {
		return "无"
	}
	return r
}

// mergeUserIDs 合并多个 user_id 切片（去重，保序）。
//
// 业务背景：多事件接收者来自"开发列表 + 创建者"两类来源，合并后必须去重
// 避免向同一用户重复 INSERT 通知（虽然 DB 不会拒绝，但用户体验是"两条一样的"）。
func mergeUserIDs(slices ...[]int64) []int64 {
	seen := make(map[int64]struct{}, 8)
	out := make([]int64, 0, 8)
	for _, s := range slices {
		for _, id := range s {
			if id == 0 {
				continue
			}
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			out = append(out, id)
		}
	}
	return out
}

// dedupRecipients 从 recipients 中过滤掉 actorUserID 自己（避免给自己发通知）。
//
// 业务背景：触发者刚做完动作不需要再收到自己动作的通知（"我自己刚点的按钮，
// 还要再通知我一次？"是糟糕 UX）。
func dedupRecipients(recipients []int64, actorUserID int64) []int64 {
	out := make([]int64, 0, len(recipients))
	for _, id := range recipients {
		if id == 0 || id == actorUserID {
			continue
		}
		out = append(out, id)
	}
	return out
}

// _ 防止未导出 helper 在某些路径下被静态分析判定 unused（编译时可访问即可）。
var _ = roleLabel

// ============================================================
// 通知派发集成入口
// ============================================================

// loadNotifyContext 在事务内一次性查询通知派发所需的全部上下文。
//
// 业务背景：
//   - statemachine 不持有项目业务字段（金额/截止日/创建者）
//   - 通知模板需要 project.name / deadline / current_quote / created_by
//     + 创建者 display_name + 触发者 display_name + 全体对接开发 user_ids
//   - 一次 SQL 拿全（用 jsonb_agg 聚合 developer_ids），减少 round-trip
//
// 返回 NotifyContext 已填充除 NewHolderUserID 外的全部字段。
func loadNotifyContext(
	ctx context.Context,
	tx pgx.Tx,
	projectID int64,
	actorUserID, actorRoleID int64,
	remark string,
	newHolderUserID *int64,
) (NotifyContext, error) {
	var (
		c                NotifyContext
		developerUserIDs []int64
	)
	row := tx.QueryRow(ctx, `
		SELECT
			p.id,
			p.name,
			p.deadline,
			p.original_quote,
			p.current_quote,
			p.after_sales_total,
			p.total_received,
			p.holder_user_id,
			p.created_by,
			creator.display_name AS creator_name,
			actor.display_name AS actor_name,
			COALESCE((
				SELECT array_agg(pd.user_id ORDER BY pd.user_id)
				FROM project_developers pd
				WHERE pd.project_id = p.id
			), ARRAY[]::bigint[]) AS developer_user_ids
		FROM projects p
		JOIN users creator ON creator.id = p.created_by
		JOIN users actor   ON actor.id   = $2
		WHERE p.id = $1
	`, projectID, actorUserID)
	if err := row.Scan(
		&c.ProjectID,
		&c.ProjectName,
		&c.ProjectDeadline,
		&c.OriginalQuote,
		&c.CurrentQuote,
		&c.AfterSalesTotal,
		&c.TotalReceived,
		&c.HolderUserID,
		&c.CreatorUserID,
		&c.CreatorName,
		&c.ActorDisplayName,
		&developerUserIDs,
	); err != nil {
		return NotifyContext{}, fmt.Errorf("loadNotifyContext: %w", err)
	}
	c.ActorUserID = actorUserID
	c.ActorRoleID = actorRoleID
	c.DeveloperUserIDs = developerUserIDs
	c.NewHolderUserID = newHolderUserID
	c.Remark = remark
	return c, nil
}

// dispatchEventNotifications 按事件模板批量 INSERT 通知。
//
// 业务流程：
//  1. 取出 EventTemplates[event]；事件未在表里 → 立即报错（防止漏配）
//  2. 渲染 title / body / recipients
//  3. 过滤掉触发者本人（避免给自己发通知）
//  4. 逐个 INSERT 调 insert_notification_secure SECURITY DEFINER 函数
//     · 接收者必须是 project_members 之一（admin viewer / owner / dev member 都已存在）
//     · 任一失败 → 整个事务回滚（不允许部分送达）
//
// 为什么不批量 INSERT：insert_notification_secure 一次只接受一个 user_id；
// 通知量级小（每事件 ≤ 10 接收者），N 次调用开销可忽略。
func dispatchEventNotifications(
	ctx context.Context,
	tx pgx.Tx,
	event oas.EventCode,
	projectID int64,
	c NotifyContext,
) error {
	tpl, ok := EventTemplates[event]
	if !ok {
		// 业务规则：所有 16 事件必须有模板；漏配 = 事件未通知 → 业务事故
		return fmt.Errorf("notification_templates: missing template for event %s", event)
	}

	title := tpl.Title(c)
	body := tpl.Body(c)
	recipients := dedupRecipients(tpl.Recipients(c), c.ActorUserID)
	if len(recipients) == 0 {
		// 唯一接收者就是触发者本人 → 静默跳过（无人需通知）；
		// 非业务异常，正常路径（如 admin 创建项目无 dev）不报错
		return nil
	}

	for _, uid := range recipients {
		var newID int64
		if err := tx.QueryRow(ctx,
			`SELECT insert_notification_secure($1, 'ball_passed'::notification_type, $2, $3, $4)`,
			uid, projectID, title, body,
		).Scan(&newID); err != nil {
			return fmt.Errorf("dispatchEventNotifications insert (event=%s user=%d): %w", event, uid, err)
		}
	}
	return nil
}

// 防止 time 包在仅文档 import 时被未引用编译警告（实际 NotifyContext.ProjectDeadline 用了）
var _ = time.Time{}
