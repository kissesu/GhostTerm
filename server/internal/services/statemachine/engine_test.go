/*
@file engine_test.go
@description 状态机引擎纯逻辑单测：
             - CanFire：每个事件的合法 / 非法路径
             - admin (RoleAdmin) 兜底放行：spec §6.2 备注
             - E12 不能从 cancelled / archived 触发（终态保护）
             - applyStateChange：白名单防御（不在白名单 → 错误，不发 SQL）

             不做的事：
             - Execute 的完整事务测试在 tests/integration/project_test.go（含真 DB）
             - INSERT status_change_logs 的副作用也在那里验
@author Atlas.oi
@date 2026-04-29
*/

package statemachine

import (
	"context"
	"errors"
	"testing"

	"github.com/ghostterm/progress-server/internal/api/oas"
)

// ============================================================
// CanFire：合法 transition 全覆盖
// ============================================================

func TestCanFire_HappyPaths(t *testing.T) {
	cs := func(v int64) *int64 { return &v }
	cases := []struct {
		name        string
		project     ProjectSnapshot
		event       EventCode
		userRole    int64
	}{
		{"E0 客服创建", ProjectSnapshot{}, oas.EventCodeE0, RoleCS},
		{"E1 客服报价", ProjectSnapshot{Status: oas.ProjectStatusDealing, HolderRoleID: cs(RoleCS)}, oas.EventCodeE1, RoleCS},
		{"E2 开发回传", ProjectSnapshot{Status: oas.ProjectStatusQuoting, HolderRoleID: cs(RoleDev)}, oas.EventCodeE2, RoleDev},
		{"E3 客服再问", ProjectSnapshot{Status: oas.ProjectStatusQuoting, HolderRoleID: cs(RoleCS)}, oas.EventCodeE3, RoleCS},
		{"E4 客户接受报价", ProjectSnapshot{Status: oas.ProjectStatusQuoting, HolderRoleID: cs(RoleCS)}, oas.EventCodeE4, RoleCS},
		{"E5 客户拒绝", ProjectSnapshot{Status: oas.ProjectStatusQuoting, HolderRoleID: cs(RoleCS)}, oas.EventCodeE5, RoleCS},
		{"E6 重新洽谈", ProjectSnapshot{Status: oas.ProjectStatusQuoting, HolderRoleID: cs(RoleCS)}, oas.EventCodeE6, RoleCS},
		{"E7 开发完成", ProjectSnapshot{Status: oas.ProjectStatusDeveloping, HolderRoleID: cs(RoleDev)}, oas.EventCodeE7, RoleDev},
		{"E8 客户要修改", ProjectSnapshot{Status: oas.ProjectStatusConfirming, HolderRoleID: cs(RoleCS)}, oas.EventCodeE8, RoleCS},
		{"E9 验收通过", ProjectSnapshot{Status: oas.ProjectStatusConfirming, HolderRoleID: cs(RoleCS)}, oas.EventCodeE9, RoleCS},
		{"E10 收款", ProjectSnapshot{Status: oas.ProjectStatusDelivered, HolderRoleID: cs(RoleCS)}, oas.EventCodeE10, RoleCS},
		{"E11 归档", ProjectSnapshot{Status: oas.ProjectStatusPaid, HolderRoleID: cs(RoleCS)}, oas.EventCodeE11, RoleCS},
		{"E12 客服取消（dealing）", ProjectSnapshot{Status: oas.ProjectStatusDealing, HolderRoleID: cs(RoleCS)}, oas.EventCodeE12, RoleCS},
		{"E12 客服取消（developing）", ProjectSnapshot{Status: oas.ProjectStatusDeveloping, HolderRoleID: cs(RoleDev)}, oas.EventCodeE12, RoleCS},
		{"E13 重启", ProjectSnapshot{Status: oas.ProjectStatusCancelled}, oas.EventCodeE13, RoleCS},
		{"E_AS1 报售后", ProjectSnapshot{Status: oas.ProjectStatusArchived}, oas.EventCodeEAS1, RoleCS},
		{"E_AS3 售后结束", ProjectSnapshot{Status: oas.ProjectStatusAfterSales, HolderRoleID: cs(RoleCS)}, oas.EventCodeEAS3, RoleCS},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if err := CanFire(c.project, c.event, c.userRole); err != nil {
				t.Errorf("CanFire 应通过：%v", err)
			}
		})
	}
}

// ============================================================
// CanFire：未知事件
// ============================================================

func TestCanFire_UnknownEvent(t *testing.T) {
	err := CanFire(ProjectSnapshot{}, EventCode("E_NOTREAL"), RoleAdmin)
	if !errors.Is(err, ErrUnknownEvent) {
		t.Errorf("err = %v；应为 ErrUnknownEvent", err)
	}
}

// ============================================================
// CanFire：role 不在 AllowedRoleIDs（admin 兜底）
// ============================================================

func TestCanFire_PermissionDenied(t *testing.T) {
	cs := func(v int64) *int64 { return &v }
	// E1 仅允许 admin/cs；dev 不允许
	err := CanFire(
		ProjectSnapshot{Status: oas.ProjectStatusDealing, HolderRoleID: cs(RoleCS)},
		oas.EventCodeE1, RoleDev,
	)
	if !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("err = %v；应为 ErrPermissionDenied", err)
	}
}

func TestCanFire_AdminAlwaysAllowed(t *testing.T) {
	// admin 触发 E2（默认允许 admin/dev），即使 holder 不是 dev 也放行
	cs := func(v int64) *int64 { return &v }
	err := CanFire(
		ProjectSnapshot{Status: oas.ProjectStatusQuoting, HolderRoleID: cs(RoleCS)},
		oas.EventCodeE2, RoleAdmin,
	)
	if err != nil {
		t.Errorf("admin 兜底应放行：%v", err)
	}
}

// ============================================================
// CanFire：from status 不匹配
// ============================================================

func TestCanFire_InvalidStateTransition(t *testing.T) {
	cs := func(v int64) *int64 { return &v }
	// 项目当前是 dealing，但试图 E3（要求 quoting/cs）
	err := CanFire(
		ProjectSnapshot{Status: oas.ProjectStatusDealing, HolderRoleID: cs(RoleCS)},
		oas.EventCodeE3, RoleCS,
	)
	if !errors.Is(err, ErrInvalidStateTransition) {
		t.Errorf("err = %v；应为 ErrInvalidStateTransition", err)
	}
}

// ============================================================
// CanFire：from holder 不匹配（非 admin 路径）
// ============================================================

func TestCanFire_InvalidHolder(t *testing.T) {
	cs := func(v int64) *int64 { return &v }
	// E1 要求 holder=cs；但传 holder=dev
	err := CanFire(
		ProjectSnapshot{Status: oas.ProjectStatusDealing, HolderRoleID: cs(RoleDev)},
		oas.EventCodeE1, RoleCS,
	)
	if !errors.Is(err, ErrInvalidHolder) {
		t.Errorf("err = %v；应为 ErrInvalidHolder", err)
	}
}

// ============================================================
// E12：不能从 cancelled / archived 再取消（终态保护）
// ============================================================

func TestCanFire_E12_TerminalGuard(t *testing.T) {
	// cancelled
	err := CanFire(ProjectSnapshot{Status: oas.ProjectStatusCancelled}, oas.EventCodeE12, RoleCS)
	if !errors.Is(err, ErrInvalidStateTransition) {
		t.Errorf("E12 from cancelled 应被拒绝：err = %v", err)
	}
	// archived
	err = CanFire(ProjectSnapshot{Status: oas.ProjectStatusArchived}, oas.EventCodeE12, RoleCS)
	if !errors.Is(err, ErrInvalidStateTransition) {
		t.Errorf("E12 from archived 应被拒绝：err = %v", err)
	}
}

// ============================================================
// CanFire：holder=nil 但事件要求 holder（非 admin）
// ============================================================

func TestCanFire_HolderNilWhenRequired(t *testing.T) {
	// E1 要求 holder=cs；project.HolderRoleID=nil
	err := CanFire(
		ProjectSnapshot{Status: oas.ProjectStatusDealing, HolderRoleID: nil},
		oas.EventCodeE1, RoleCS,
	)
	if !errors.Is(err, ErrInvalidHolder) {
		t.Errorf("err = %v；应为 ErrInvalidHolder（holder 为 nil 但事件要求）", err)
	}
}

// ============================================================
// applyStateChange 白名单：tx=nil 时不会被调到，但白名单防御先抓
// ============================================================

func TestApplyStateChange_WhitelistDefense(t *testing.T) {
	// 模拟 future 代码改坏 transitions 表，传入恶意列名
	err := applyStateChange(
		context.Background(),
		nil, // tx: 不会被用到，因为白名单先报错
		1,
		oas.ProjectStatusDealing,
		nil, nil,
		`evil_col=1; DROP TABLE projects --`,
	)
	if !errors.Is(err, ErrInvalidEnterTSColumn) {
		t.Errorf("err = %v；应为 ErrInvalidEnterTSColumn（白名单必须先抓）", err)
	}

	// 空字符串也必须被白名单拦截
	err = applyStateChange(context.Background(), nil, 1, oas.ProjectStatusDealing, nil, nil, "")
	if !errors.Is(err, ErrInvalidEnterTSColumn) {
		t.Errorf("空列名 err = %v；应为 ErrInvalidEnterTSColumn", err)
	}
}

// ============================================================
// Execute 入参防御：tx=nil
// ============================================================

func TestExecute_NilTx(t *testing.T) {
	_, err := Execute(context.Background(), nil, ExecuteParams{
		Event: oas.EventCodeE0,
	})
	if err == nil {
		t.Error("tx=nil 应报错")
	}
}

// ============================================================
// Execute 入参防御：未知事件
// ============================================================

// 注：用 nil tx 但事件要在 tx 之前先报 ErrUnknownEvent；
// 实测代码顺序：先 tx 校验 → 再 FindTransition；所以这里跑不了 nil tx case。
// 改用一个不会真访问 tx 的 path：未知事件让 FindTransition 在 tx 校验之后立即返回错误，
// 但因 tx 校验先发生，构造不进 FindTransition 分支。这里只验证未知事件经 CanFire 失败。
func TestExecute_UnknownEventViaCanFire(t *testing.T) {
	// CanFire 路径已经能验证未知事件；Execute 内部依赖 FindTransition 在 tx 之后，
	// 真实场景测试看 integration test。
	err := CanFire(ProjectSnapshot{}, EventCode("E_NOTEXIST"), RoleAdmin)
	if !errors.Is(err, ErrUnknownEvent) {
		t.Errorf("CanFire 未知事件 err = %v；应为 ErrUnknownEvent", err)
	}
}
