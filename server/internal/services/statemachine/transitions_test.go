/*
@file transitions_test.go
@description transitions 表的纯逻辑覆盖测试：
             - 16 个事件全部存在
             - 每条 transition 的 (From, To, holder, EnterTSColumn) 与 spec §6.2 对齐
             - EnterTSColumn 全部在 AllowedEnterTSColumns 白名单内
             - EnterTSColumnForStatus 9 状态全覆盖
@author Atlas.oi
@date 2026-04-29
*/

package statemachine

import (
	"testing"

	"github.com/ghostterm/progress-server/internal/api/oas"
)

// ============================================================
// 16 个事件全部在 Transitions 表中
// ============================================================

func TestTransitions_AllEventsCovered(t *testing.T) {
	want := []EventCode{
		oas.EventCodeE0, oas.EventCodeE1, oas.EventCodeE2, oas.EventCodeE3,
		oas.EventCodeE4, oas.EventCodeE5, oas.EventCodeE6, oas.EventCodeE7,
		oas.EventCodeE8, oas.EventCodeE9, oas.EventCodeE10, oas.EventCodeE11,
		oas.EventCodeE12, oas.EventCodeE13,
		oas.EventCodeEAS1, oas.EventCodeEAS3,
	}
	if len(Transitions) != len(want) {
		t.Errorf("Transitions 数量 = %d，期望 %d；漏定义事件会破坏前端事件枚举", len(Transitions), len(want))
	}
	for _, ec := range want {
		if _, ok := Transitions[ec]; !ok {
			t.Errorf("Transitions 缺事件 %s", ec)
		}
	}
}

// ============================================================
// 每条 transition 的关键字段（按 spec §6.2 行项）
// ============================================================

// expectedTransition 是 spec §6.2 表格的精简表示。
type expectedTransition struct {
	from         ProjectStatus
	fromHolder   *int64 // nil = 无要求
	to           ProjectStatus
	toHolder     *int64 // nil = 终态/不变
	enterCol     string
	allowedRoles []int64
}

func TestTransitions_MatchSpec(t *testing.T) {
	cs := func(v int64) *int64 { return &v }
	expected := map[EventCode]expectedTransition{
		oas.EventCodeE0:   {"", nil, oas.ProjectStatusDealing, cs(RoleCS), "dealing_at", []int64{RoleAdmin, RoleCS}},
		oas.EventCodeE1:   {oas.ProjectStatusDealing, cs(RoleCS), oas.ProjectStatusQuoting, cs(RoleDev), "quoting_at", []int64{RoleAdmin, RoleCS}},
		oas.EventCodeE2:   {oas.ProjectStatusQuoting, cs(RoleDev), oas.ProjectStatusQuoting, cs(RoleCS), "quoting_at", []int64{RoleAdmin, RoleDev}},
		oas.EventCodeE3:   {oas.ProjectStatusQuoting, cs(RoleCS), oas.ProjectStatusQuoting, cs(RoleDev), "quoting_at", []int64{RoleAdmin, RoleCS}},
		oas.EventCodeE4:   {oas.ProjectStatusQuoting, cs(RoleCS), oas.ProjectStatusDeveloping, cs(RoleDev), "dev_started_at", []int64{RoleAdmin, RoleCS}},
		oas.EventCodeE5:   {oas.ProjectStatusQuoting, cs(RoleCS), oas.ProjectStatusCancelled, nil, "cancelled_at", []int64{RoleAdmin, RoleCS}},
		oas.EventCodeE6:   {oas.ProjectStatusQuoting, cs(RoleCS), oas.ProjectStatusDealing, cs(RoleCS), "dealing_at", []int64{RoleAdmin, RoleCS}},
		oas.EventCodeE7:   {oas.ProjectStatusDeveloping, cs(RoleDev), oas.ProjectStatusConfirming, cs(RoleCS), "confirming_at", []int64{RoleAdmin, RoleDev}},
		oas.EventCodeE8:   {oas.ProjectStatusConfirming, cs(RoleCS), oas.ProjectStatusDeveloping, cs(RoleDev), "dev_started_at", []int64{RoleAdmin, RoleCS}},
		oas.EventCodeE9:   {oas.ProjectStatusConfirming, cs(RoleCS), oas.ProjectStatusDelivered, cs(RoleCS), "delivered_at", []int64{RoleAdmin, RoleCS}},
		oas.EventCodeE10:  {oas.ProjectStatusDelivered, cs(RoleCS), oas.ProjectStatusPaid, cs(RoleCS), "paid_at", []int64{RoleAdmin, RoleCS}},
		oas.EventCodeE11:  {oas.ProjectStatusPaid, cs(RoleCS), oas.ProjectStatusArchived, nil, "archived_at", []int64{RoleAdmin, RoleCS}},
		oas.EventCodeE12:  {"", nil, oas.ProjectStatusCancelled, nil, "cancelled_at", []int64{RoleAdmin, RoleCS}},
		oas.EventCodeE13:  {oas.ProjectStatusCancelled, nil, "", nil, "", []int64{RoleAdmin, RoleCS}},
		oas.EventCodeEAS1: {oas.ProjectStatusArchived, nil, oas.ProjectStatusAfterSales, cs(RoleCS), "after_sales_at", []int64{RoleAdmin, RoleCS}},
		oas.EventCodeEAS3: {oas.ProjectStatusAfterSales, cs(RoleCS), oas.ProjectStatusArchived, nil, "archived_at", []int64{RoleAdmin, RoleCS}},
	}

	for ec, exp := range expected {
		got, ok := Transitions[ec]
		if !ok {
			t.Fatalf("Transitions 缺 %s", ec)
		}
		if got.From != exp.from {
			t.Errorf("%s.From = %q; want %q", ec, got.From, exp.from)
		}
		if !ptrEq(got.FromHolderRole, exp.fromHolder) {
			t.Errorf("%s.FromHolderRole = %v; want %v", ec, derefOrNil(got.FromHolderRole), derefOrNil(exp.fromHolder))
		}
		if got.To != exp.to {
			t.Errorf("%s.To = %q; want %q", ec, got.To, exp.to)
		}
		if !ptrEq(got.ToHolderRole, exp.toHolder) {
			t.Errorf("%s.ToHolderRole = %v; want %v", ec, derefOrNil(got.ToHolderRole), derefOrNil(exp.toHolder))
		}
		if got.EnterTSColumn != exp.enterCol {
			t.Errorf("%s.EnterTSColumn = %q; want %q", ec, got.EnterTSColumn, exp.enterCol)
		}
		if !sliceEq(got.AllowedRoleIDs, exp.allowedRoles) {
			t.Errorf("%s.AllowedRoleIDs = %v; want %v", ec, got.AllowedRoleIDs, exp.allowedRoles)
		}
	}
}

// ============================================================
// 白名单：所有 transition.EnterTSColumn 都在 AllowedEnterTSColumns 内
// （E13 的 "" 除外，运行时根据快照 status 选）
// ============================================================

func TestTransitions_EnterTSColumnsInWhitelist(t *testing.T) {
	for ec, tr := range Transitions {
		if tr.EnterTSColumn == "" {
			continue // E13 运行时还原
		}
		if !AllowedEnterTSColumns[tr.EnterTSColumn] {
			t.Errorf("%s.EnterTSColumn=%q 不在 AllowedEnterTSColumns 白名单（潜在 SQL 注入风险）",
				ec, tr.EnterTSColumn)
		}
	}
}

// ============================================================
// EnterTSColumnForStatus：9 状态全覆盖
// ============================================================

func TestEnterTSColumnForStatus(t *testing.T) {
	cases := map[ProjectStatus]string{
		oas.ProjectStatusDealing:    "dealing_at",
		oas.ProjectStatusQuoting:    "quoting_at",
		oas.ProjectStatusDeveloping: "dev_started_at",
		oas.ProjectStatusConfirming: "confirming_at",
		oas.ProjectStatusDelivered:  "delivered_at",
		oas.ProjectStatusPaid:       "paid_at",
		oas.ProjectStatusArchived:   "archived_at",
		oas.ProjectStatusAfterSales: "after_sales_at",
		oas.ProjectStatusCancelled:  "cancelled_at",
	}
	for status, want := range cases {
		got := EnterTSColumnForStatus(status)
		if got != want {
			t.Errorf("EnterTSColumnForStatus(%q) = %q; want %q", status, got, want)
		}
		if !AllowedEnterTSColumns[got] {
			t.Errorf("EnterTSColumnForStatus(%q)=%q 不在白名单", status, got)
		}
	}
	// 未知 status：返回空串（让 caller 报错）
	if got := EnterTSColumnForStatus(""); got != "" {
		t.Errorf("EnterTSColumnForStatus(\"\") = %q; want \"\"", got)
	}
}

// ============================================================
// FindTransition：找不到返回 ok=false
// ============================================================

func TestFindTransition(t *testing.T) {
	if _, ok := FindTransition(oas.EventCodeE0); !ok {
		t.Error("FindTransition(E0) 应找到")
	}
	if _, ok := FindTransition(EventCode("E_NOTREAL")); ok {
		t.Error("FindTransition(E_NOTREAL) 应返回 ok=false")
	}
}

// ============================================================
// helpers
// ============================================================

func ptrEq(a, b *int64) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

func derefOrNil(p *int64) any {
	if p == nil {
		return nil
	}
	return *p
}

func sliceEq(a, b []int64) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
