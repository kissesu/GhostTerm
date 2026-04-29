/*
@file project_service_test.go
@description ProjectService 的纯逻辑单测：
             - validateCreateInput：必填字段校验
             - NewProjectService 必填依赖
             - Create 角色防御：非 admin/cs 直接拒绝（不进 tx）

             集成测试（真 DB）在 tests/integration/project_test.go：
             - C3 原子性
             - C4 E12 快照 + E13 还原
             - W9 白名单 SQL（间接：所有 happy 路径都通过 applyStateChange）
             - RLS 隔离
@author Atlas.oi
@date 2026-04-29
*/

package services

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ghostterm/progress-server/internal/api/oas"
	progressdb "github.com/ghostterm/progress-server/internal/db"
)

// ============================================================
// validateCreateInput
// ============================================================

func TestValidateCreateInput(t *testing.T) {
	deadline := time.Now().Add(7 * 24 * time.Hour)

	cases := []struct {
		name    string
		in      CreateProjectInput
		wantErr bool
	}{
		{"valid 全字段", CreateProjectInput{
			Name: "demo", CustomerID: 1, Description: "desc", Deadline: deadline,
		}, false},
		{"name 空", CreateProjectInput{
			Name: "", CustomerID: 1, Description: "desc", Deadline: deadline,
		}, true},
		{"customerID 0", CreateProjectInput{
			Name: "demo", CustomerID: 0, Description: "desc", Deadline: deadline,
		}, true},
		{"description 空", CreateProjectInput{
			Name: "demo", CustomerID: 1, Description: "", Deadline: deadline,
		}, true},
		{"deadline zero", CreateProjectInput{
			Name: "demo", CustomerID: 1, Description: "desc", Deadline: time.Time{},
		}, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := validateCreateInput(c.in)
			if c.wantErr && err == nil {
				t.Error("应返回 ErrProjectInvalidInput")
			}
			if !c.wantErr && err != nil {
				t.Errorf("err = %v；不应报错", err)
			}
			if err != nil && !errors.Is(err, ErrProjectInvalidInput) {
				t.Errorf("err = %v；应是 ErrProjectInvalidInput", err)
			}
		})
	}
}

// ============================================================
// NewProjectService 必填校验
// ============================================================

func TestNewProjectService_RequiresPool(t *testing.T) {
	_, err := NewProjectService(ProjectServiceDeps{Pool: nil})
	if err == nil {
		t.Error("Pool=nil 应返回 error")
	}
}

// ============================================================
// Create：角色非 admin/cs 直接被拒绝（在进 tx 之前）
// ============================================================

func TestCreate_RolePermissionDefense(t *testing.T) {
	// dev role (2) 不能创建项目
	svc := &ProjectServiceImpl{pool: nil} // pool=nil 也无所谓，因为不会进入 InTx
	deadline := time.Now().Add(7 * 24 * time.Hour)
	_, err := svc.Create(
		context.Background(),
		100, // userID
		2,   // dev role
		CreateProjectInput{
			Name: "x", CustomerID: 1, Description: "y", Deadline: deadline,
		},
	)
	if !errors.Is(err, ErrProjectPermissionDenied) {
		t.Errorf("err = %v；应返回 ErrProjectPermissionDenied", err)
	}
}

func TestCreate_InvalidInputDefense(t *testing.T) {
	svc := &ProjectServiceImpl{pool: nil}
	_, err := svc.Create(context.Background(), 100, 3 /* cs */, CreateProjectInput{
		// name 空
		Name: "", CustomerID: 1, Description: "y", Deadline: time.Now().Add(time.Hour),
	})
	if !errors.Is(err, ErrProjectInvalidInput) {
		t.Errorf("err = %v；应返回 ErrProjectInvalidInput", err)
	}
}

// ============================================================
// 单元测试占位：UpdateProjectInput.Subject 区分"不动"和"清空"
//
// 业务背景：API PATCH 语义中，subject 字段的 nullable=true 让前端可以传 null
// 来"清空" subject；同时缺失字段表示"不更新"。
// 本 service 用 ClearSubject bool 区分这两个语义；不建 DB 不做完整 UPDATE 验证，
// 那放 integration test。
// ============================================================

func TestUpdateProjectInput_ClearSubjectFlag(t *testing.T) {
	// 仅做 struct 字段存在性 / 互斥逻辑的小检查
	in := UpdateProjectInput{ClearSubject: true}
	if !in.ClearSubject {
		t.Fatal("ClearSubject 应为 true")
	}
	if in.Subject != nil {
		t.Error("ClearSubject=true 时 Subject 应保持 nil（不冲突）")
	}
}

// ============================================================
// 编译时校验：Money 类型在 ProjectModel 中
// ============================================================

func TestProjectModel_MoneyFieldType(t *testing.T) {
	// 仅证明 Money 类型与 progressdb.Money 一致（编译期通过即测试通过）
	var _ progressdb.Money = ProjectModel{}.OriginalQuote
	var _ progressdb.Money = ProjectModel{}.CurrentQuote
	var _ progressdb.Money = ProjectModel{}.AfterSalesTotal
	var _ progressdb.Money = ProjectModel{}.TotalReceived
}

// ============================================================
// ProjectStatus enum 一致性：spec 9 状态对齐 oas
// ============================================================

func TestProjectStatusEnumConsistency(t *testing.T) {
	want := []oas.ProjectStatus{
		oas.ProjectStatusDealing, oas.ProjectStatusQuoting,
		oas.ProjectStatusDeveloping, oas.ProjectStatusConfirming,
		oas.ProjectStatusDelivered, oas.ProjectStatusPaid,
		oas.ProjectStatusArchived, oas.ProjectStatusAfterSales,
		oas.ProjectStatusCancelled,
	}
	got := oas.ProjectStatus("").AllValues()
	if len(got) != len(want) {
		t.Errorf("ProjectStatus 数量 = %d；want %d", len(got), len(want))
	}
}
