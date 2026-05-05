/*
@file engine_test.go
@description 状态机引擎纯逻辑单测：
             - CanFire：每个事件的合法 / 非法路径
             - admin (RoleAdmin) 兜底放行：spec §6.2 备注（仅对 holder 检查兜底）
             - E12 不能从 cancelled / archived 触发（终态保护）
             - applyStateChange：白名单防御（不在白名单 → 错误，不发 SQL）

             2026-05-04 简化后：
             - 删 dealing 状态 + E1/E6 事件
             - 删 AllowedRoleIDs 字段及 ErrPermissionDenied（角色控制由 service 层权限码做）
             - CanFire 仅校验 status + holder

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
		name     string
		project  ProjectSnapshot
		event    EventCode
		userRole int64
	}{
		{"E0 创建", ProjectSnapshot{}, oas.EventCodeE0, RoleCS},
		{"E2 开发提交报价", ProjectSnapshot{Status: oas.ProjectStatusQuoting, HolderRoleID: cs(RoleDev)}, oas.EventCodeE2, RoleDev},
		{"E3 客服再问开发", ProjectSnapshot{Status: oas.ProjectStatusQuoting, HolderRoleID: cs(RoleCS)}, oas.EventCodeE3, RoleCS},
		{"E4 客户接受报价", ProjectSnapshot{Status: oas.ProjectStatusQuoting, HolderRoleID: cs(RoleCS)}, oas.EventCodeE4, RoleCS},
		{"E5 客户拒绝", ProjectSnapshot{Status: oas.ProjectStatusQuoting, HolderRoleID: cs(RoleCS)}, oas.EventCodeE5, RoleCS},
		{"E7 开发完成", ProjectSnapshot{Status: oas.ProjectStatusDeveloping, HolderRoleID: cs(RoleDev)}, oas.EventCodeE7, RoleDev},
		{"E8 客户要修改", ProjectSnapshot{Status: oas.ProjectStatusConfirming, HolderRoleID: cs(RoleCS)}, oas.EventCodeE8, RoleCS},
		{"E9 验收通过", ProjectSnapshot{Status: oas.ProjectStatusConfirming, HolderRoleID: cs(RoleCS)}, oas.EventCodeE9, RoleCS},
		{"E10 收款", ProjectSnapshot{Status: oas.ProjectStatusDelivered, HolderRoleID: cs(RoleCS)}, oas.EventCodeE10, RoleCS},
		{"E11 归档", ProjectSnapshot{Status: oas.ProjectStatusPaid, HolderRoleID: cs(RoleCS)}, oas.EventCodeE11, RoleCS},
		{"E12 客服取消（quoting）", ProjectSnapshot{Status: oas.ProjectStatusQuoting, HolderRoleID: cs(RoleDev)}, oas.EventCodeE12, RoleCS},
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
// CanFire：admin 兜底（holder 不匹配仍放行）
// ============================================================

func TestCanFire_AdminAlwaysAllowed(t *testing.T) {
	// admin 触发 E2，即使 holder 是 cs（不是 dev）也放行
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
	// 项目当前是 quoting，但试图 E7（要求 developing/dev）
	err := CanFire(
		ProjectSnapshot{Status: oas.ProjectStatusQuoting, HolderRoleID: cs(RoleDev)},
		oas.EventCodeE7, RoleDev,
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
	// E2 要求 holder=dev；但传 holder=cs（dev 触发）
	err := CanFire(
		ProjectSnapshot{Status: oas.ProjectStatusQuoting, HolderRoleID: cs(RoleCS)},
		oas.EventCodeE2, RoleDev,
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
	// E2 要求 holder=dev；project.HolderRoleID=nil
	err := CanFire(
		ProjectSnapshot{Status: oas.ProjectStatusQuoting, HolderRoleID: nil},
		oas.EventCodeE2, RoleDev,
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
		oas.ProjectStatusQuoting,
		nil, nil,
		`evil_col=1; DROP TABLE projects --`,
	)
	if !errors.Is(err, ErrInvalidEnterTSColumn) {
		t.Errorf("err = %v；应为 ErrInvalidEnterTSColumn（白名单必须先抓）", err)
	}

	// 空字符串也必须被白名单拦截
	err = applyStateChange(context.Background(), nil, 1, oas.ProjectStatusQuoting, nil, nil, "")
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
// Execute 入参防御：未知事件（CanFire 路径已能验证）
// ============================================================

func TestExecute_UnknownEventViaCanFire(t *testing.T) {
	err := CanFire(ProjectSnapshot{}, EventCode("E_NOTEXIST"), RoleAdmin)
	if !errors.Is(err, ErrUnknownEvent) {
		t.Errorf("CanFire 未知事件 err = %v；应为 ErrUnknownEvent", err)
	}
}
