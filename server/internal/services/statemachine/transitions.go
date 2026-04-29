/*
@file transitions.go
@description 项目状态机的事件 → transition 映射表（硬编码）。

             业务背景（spec §6.2 + v2 §C4）：
             - 共 16 个事件：E0/E1..E13 + E_AS1/E_AS3
             - 每个 transition 描述：允许触发的 role、from(状态+持球者)、to(状态+持球者)、
               进入时间戳列名（用于 W9 白名单 UPDATE）、是否需要写日志
             - E12 取消 / E13 重启取消 是特殊事件：
               · E12：from 任意非终态 → cancelled，需要把"取消前快照"写入 status_change_logs.from_*
               · E13：from cancelled → 由 logs 中最近一次 E12 的 from_status / from_holder_*
                      精确还原（spec §6.5 + v2 part1 §C4）

             硬编码而非 DB 配置的取舍：
             - 状态机结构是核心业务规则，错配 = 财务事故；放代码里走 PR review 比 DB 配置安全
             - 添加新事件 = 改 spec + 改本表 + 跑 unit test，三方共同把关
             - DB-driven 配置会让"业务规则"漂出 git 历史，团队无法 git blame

@author Atlas.oi
@date 2026-04-29
*/

package statemachine

import (
	"github.com/ghostterm/progress-server/internal/api/oas"
)

// EventCode 是状态机事件码的强类型别名（与 OAS 生成的 EventCode 同源）。
type EventCode = oas.EventCode

// ProjectStatus 是项目状态枚举（与 OAS / DB enum 三处对齐）。
type ProjectStatus = oas.ProjectStatus

// 角色 ID 常量（与 0001 migration 预置一致）。
//
// 业务背景：
// - role_id=1 admin（超管，对所有事件有兜底权）
// - role_id=2 dev（开发）
// - role_id=3 cs（客服）
const (
	RoleAdmin int64 = 1
	RoleDev   int64 = 2
	RoleCS    int64 = 3
)

// Transition 描述单条状态机跳转规则。
//
// 字段语义：
//   - Event:           事件码
//   - AllowedRoleIDs:  哪些角色可以触发；admin(1) 默认始终可触发（在 CanFire 单独处理）
//   - From:            前置 status；空串表示"无状态"（仅 E0 创建用）
//   - FromHolderRole:  前置持球者角色；nil 表示对持球者无要求
//   - To:              后置 status
//   - ToHolderRole:    后置持球者角色；nil 表示"清空持球者"（终态 archived/cancelled）
//   - EnterTSColumn:   后置状态对应的 *_at 时间戳列名（W9 白名单），
//                      用于 applyStateChange 选择哪条静态 SQL；
//                      空串表示"不更新任何 enter ts"（如 E10/E11 仅 logs，不变状态）
//   - Description:     中文事件名（写入 status_change_logs.event_name）
//   - RequiresRemark:  是否要求 remark 必填（spec §6.2 全部为 true）
type Transition struct {
	Event          EventCode
	AllowedRoleIDs []int64
	From           ProjectStatus
	FromHolderRole *int64
	To             ProjectStatus
	ToHolderRole   *int64
	EnterTSColumn  string
	Description    string
	RequiresRemark bool
}

// roleIDPtr 返回指向 v 的指针（语法糖，构造表更紧凑）。
func roleIDPtr(v int64) *int64 { return &v }

// Transitions 是全局事件 → transition 的映射表（spec §6.2 + v2 §C4）。
//
// 注：
//   - E10/E11 在 v2 §C4 重新解读为"前向状态机"的常规 transition：
//     E10 收款 (delivered/cs) → (paid/cs)
//     E11 归档 (paid/cs) → (archived/—)
//   - E12 的 From="" 表示"任意非终态"，CanFire 内特殊处理（不走通用 From 比对）
//   - E13 的 From=cancelled，但 To 由 ExecuteEvent 在运行时从 logs 读取（不在表里写死）
//   - E_AS1 / E_AS3 与售后流程相关（spec §6.3 ping-pong 简化为两个端点切换）
var Transitions = map[EventCode]Transition{
	oas.EventCodeE0: {
		Event:          oas.EventCodeE0,
		AllowedRoleIDs: []int64{RoleAdmin, RoleCS},
		From:           "",
		FromHolderRole: nil,
		To:             oas.ProjectStatusDealing,
		ToHolderRole:   roleIDPtr(RoleCS),
		EnterTSColumn:  "dealing_at",
		Description:    "创建项目",
		RequiresRemark: false,
	},
	oas.EventCodeE1: {
		Event:          oas.EventCodeE1,
		AllowedRoleIDs: []int64{RoleAdmin, RoleCS},
		From:           oas.ProjectStatusDealing,
		FromHolderRole: roleIDPtr(RoleCS),
		To:             oas.ProjectStatusQuoting,
		ToHolderRole:   roleIDPtr(RoleDev),
		EnterTSColumn:  "quoting_at",
		Description:    "提交报价评估",
		RequiresRemark: true,
	},
	oas.EventCodeE2: {
		Event:          oas.EventCodeE2,
		AllowedRoleIDs: []int64{RoleAdmin, RoleDev},
		From:           oas.ProjectStatusQuoting,
		FromHolderRole: roleIDPtr(RoleDev),
		To:             oas.ProjectStatusQuoting,
		ToHolderRole:   roleIDPtr(RoleCS),
		EnterTSColumn:  "quoting_at",
		Description:    "评估完成回传",
		RequiresRemark: true,
	},
	oas.EventCodeE3: {
		Event:          oas.EventCodeE3,
		AllowedRoleIDs: []int64{RoleAdmin, RoleCS},
		From:           oas.ProjectStatusQuoting,
		FromHolderRole: roleIDPtr(RoleCS),
		To:             oas.ProjectStatusQuoting,
		ToHolderRole:   roleIDPtr(RoleDev),
		EnterTSColumn:  "quoting_at",
		Description:    "再问开发",
		RequiresRemark: true,
	},
	oas.EventCodeE4: {
		Event:          oas.EventCodeE4,
		AllowedRoleIDs: []int64{RoleAdmin, RoleCS},
		From:           oas.ProjectStatusQuoting,
		FromHolderRole: roleIDPtr(RoleCS),
		To:             oas.ProjectStatusDeveloping,
		ToHolderRole:   roleIDPtr(RoleDev),
		EnterTSColumn:  "dev_started_at",
		Description:    "客户接受报价",
		RequiresRemark: true,
	},
	oas.EventCodeE5: {
		Event:          oas.EventCodeE5,
		AllowedRoleIDs: []int64{RoleAdmin, RoleCS},
		From:           oas.ProjectStatusQuoting,
		FromHolderRole: roleIDPtr(RoleCS),
		To:             oas.ProjectStatusCancelled,
		ToHolderRole:   nil,
		EnterTSColumn:  "cancelled_at",
		Description:    "客户拒绝报价",
		RequiresRemark: true,
	},
	oas.EventCodeE6: {
		Event:          oas.EventCodeE6,
		AllowedRoleIDs: []int64{RoleAdmin, RoleCS},
		From:           oas.ProjectStatusQuoting,
		FromHolderRole: roleIDPtr(RoleCS),
		To:             oas.ProjectStatusDealing,
		ToHolderRole:   roleIDPtr(RoleCS),
		EnterTSColumn:  "dealing_at",
		Description:    "重新洽谈",
		RequiresRemark: true,
	},
	oas.EventCodeE7: {
		Event:          oas.EventCodeE7,
		AllowedRoleIDs: []int64{RoleAdmin, RoleDev},
		From:           oas.ProjectStatusDeveloping,
		FromHolderRole: roleIDPtr(RoleDev),
		To:             oas.ProjectStatusConfirming,
		ToHolderRole:   roleIDPtr(RoleCS),
		EnterTSColumn:  "confirming_at",
		Description:    "开发完成",
		RequiresRemark: true,
	},
	oas.EventCodeE8: {
		Event:          oas.EventCodeE8,
		AllowedRoleIDs: []int64{RoleAdmin, RoleCS},
		From:           oas.ProjectStatusConfirming,
		FromHolderRole: roleIDPtr(RoleCS),
		To:             oas.ProjectStatusDeveloping,
		ToHolderRole:   roleIDPtr(RoleDev),
		EnterTSColumn:  "dev_started_at",
		Description:    "客户要修改",
		RequiresRemark: true,
	},
	oas.EventCodeE9: {
		Event:          oas.EventCodeE9,
		AllowedRoleIDs: []int64{RoleAdmin, RoleCS},
		From:           oas.ProjectStatusConfirming,
		FromHolderRole: roleIDPtr(RoleCS),
		To:             oas.ProjectStatusDelivered,
		ToHolderRole:   roleIDPtr(RoleCS),
		EnterTSColumn:  "delivered_at",
		Description:    "客户验收通过",
		RequiresRemark: true,
	},
	oas.EventCodeE10: {
		Event:          oas.EventCodeE10,
		AllowedRoleIDs: []int64{RoleAdmin, RoleCS},
		From:           oas.ProjectStatusDelivered,
		FromHolderRole: roleIDPtr(RoleCS),
		To:             oas.ProjectStatusPaid,
		ToHolderRole:   roleIDPtr(RoleCS),
		EnterTSColumn:  "paid_at",
		Description:    "确认收款",
		RequiresRemark: true,
	},
	oas.EventCodeE11: {
		Event:          oas.EventCodeE11,
		AllowedRoleIDs: []int64{RoleAdmin, RoleCS},
		From:           oas.ProjectStatusPaid,
		FromHolderRole: roleIDPtr(RoleCS),
		To:             oas.ProjectStatusArchived,
		ToHolderRole:   nil,
		EnterTSColumn:  "archived_at",
		Description:    "归档",
		RequiresRemark: true,
	},
	// E12: From="" 通配（任意非终态），CanFire 内特殊处理
	oas.EventCodeE12: {
		Event:          oas.EventCodeE12,
		AllowedRoleIDs: []int64{RoleAdmin, RoleCS},
		From:           "",
		FromHolderRole: nil,
		To:             oas.ProjectStatusCancelled,
		ToHolderRole:   nil,
		EnterTSColumn:  "cancelled_at",
		Description:    "取消",
		RequiresRemark: true,
	},
	// E13: From=cancelled, To 在运行时由快照决定
	oas.EventCodeE13: {
		Event:          oas.EventCodeE13,
		AllowedRoleIDs: []int64{RoleAdmin, RoleCS},
		From:           oas.ProjectStatusCancelled,
		FromHolderRole: nil,
		To:             "", // 由 ExecuteEvent 运行时还原
		ToHolderRole:   nil,
		EnterTSColumn:  "", // 同上，运行时按 To 状态选列
		Description:    "重启取消",
		RequiresRemark: true,
	},
	oas.EventCodeEAS1: {
		Event:          oas.EventCodeEAS1,
		AllowedRoleIDs: []int64{RoleAdmin, RoleCS},
		From:           oas.ProjectStatusArchived,
		FromHolderRole: nil,
		To:             oas.ProjectStatusAfterSales,
		ToHolderRole:   roleIDPtr(RoleCS),
		EnterTSColumn:  "after_sales_at",
		Description:    "客户报售后",
		RequiresRemark: true,
	},
	oas.EventCodeEAS3: {
		Event:          oas.EventCodeEAS3,
		AllowedRoleIDs: []int64{RoleAdmin, RoleCS},
		From:           oas.ProjectStatusAfterSales,
		FromHolderRole: roleIDPtr(RoleCS),
		To:             oas.ProjectStatusArchived,
		ToHolderRole:   nil,
		EnterTSColumn:  "archived_at",
		Description:    "售后已结束",
		RequiresRemark: true,
	},
}

// FindTransition 按事件码取出 transition；不存在返回 (zero, false)。
func FindTransition(event EventCode) (Transition, bool) {
	t, ok := Transitions[event]
	return t, ok
}

// AllowedEnterTSColumns 是 W9 白名单：所有 9 个允许出现在动态 SQL 中的列名。
//
// 业务背景（v2 part2 §W9）：
// 即使 Transition.EnterTSColumn 来自硬编码常量，applyStateChange 仍然要做白名单二次校验，
// 防止"测试代码或 future 代码改坏 transitions 表把恶意列名注入"造成 SQL 注入。
// 多一层防御不耗资源，被攻破时可救命。
var AllowedEnterTSColumns = map[string]bool{
	"dealing_at":     true,
	"quoting_at":     true,
	"dev_started_at": true,
	"confirming_at":  true,
	"delivered_at":   true,
	"paid_at":        true,
	"archived_at":    true,
	"after_sales_at": true,
	"cancelled_at":   true,
}

// EnterTSColumnForStatus 返回 status 对应的 enter ts 列名（用于 E13 还原后选列）。
//
// 业务背景：transitions 表里写死了正向 transition 的 EnterTSColumn，
// E13 还原走的是"任意 status → 它的 *_at 列"映射，需要单独函数。
// 拒绝用 fmt.Sprintf("%s_at", status) 的字符串拼接：尽管 ProjectStatus 是 enum
// 类型受 unmarshal 校验，但显式 switch 让"漏掉新 status"在编译期 / 测试期暴露。
func EnterTSColumnForStatus(status ProjectStatus) string {
	switch status {
	case oas.ProjectStatusDealing:
		return "dealing_at"
	case oas.ProjectStatusQuoting:
		return "quoting_at"
	case oas.ProjectStatusDeveloping:
		return "dev_started_at"
	case oas.ProjectStatusConfirming:
		return "confirming_at"
	case oas.ProjectStatusDelivered:
		return "delivered_at"
	case oas.ProjectStatusPaid:
		return "paid_at"
	case oas.ProjectStatusArchived:
		return "archived_at"
	case oas.ProjectStatusAfterSales:
		return "after_sales_at"
	case oas.ProjectStatusCancelled:
		return "cancelled_at"
	}
	return ""
}
