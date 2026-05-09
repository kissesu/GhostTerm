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
	"strings"
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
		// 注（2026-05-04）：删 dealing 状态后 E0 直接进 quoting/dev，DeveloperUserIDs 必填非空
		// 才能取 firstDevUserID 作为初始 holder；这里 valid 用例必须带 DeveloperUserIDs
		{"valid 全字段", CreateProjectInput{
			Name: "demo", CustomerLabel: "测试客户", Description: "desc", Deadline: deadline,
			DeveloperUserIDs: []int64{42},
		}, false},
		{"name 空", CreateProjectInput{
			Name: "", CustomerLabel: "测试客户", Description: "desc", Deadline: deadline,
			DeveloperUserIDs: []int64{42},
		}, true},
		{"customerLabel 空", CreateProjectInput{
			Name: "demo", CustomerLabel: "", Description: "desc", Deadline: deadline,
			DeveloperUserIDs: []int64{42},
		}, true},
		{"description 空", CreateProjectInput{
			Name: "demo", CustomerLabel: "测试客户", Description: "", Deadline: deadline,
			DeveloperUserIDs: []int64{42},
		}, true},
		{"deadline zero", CreateProjectInput{
			Name: "demo", CustomerLabel: "测试客户", Description: "desc", Deadline: time.Time{},
			DeveloperUserIDs: []int64{42},
		}, true},
		// 项目名 50 字符上限边界：50 字符通过、51 字符拒（按 Unicode 码点；与前端 zod.max(50) + DB CHECK 三层一致）
		{"name 边界 50 字符（应通过）", CreateProjectInput{
			Name: strings.Repeat("a", 50), CustomerLabel: "x", Description: "y", Deadline: deadline,
			DeveloperUserIDs: []int64{42},
		}, false},
		{"name 51 字符（应拒）", CreateProjectInput{
			Name: strings.Repeat("a", 51), CustomerLabel: "x", Description: "y", Deadline: deadline,
			DeveloperUserIDs: []int64{42},
		}, true},
		{"name 50 个汉字（应通过；汉字 BMP=1 rune）", CreateProjectInput{
			Name: strings.Repeat("中", 50), CustomerLabel: "x", Description: "y", Deadline: deadline,
			DeveloperUserIDs: []int64{42},
		}, false},
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
			Name: "x", CustomerLabel: "测试客户", Description: "y", Deadline: deadline,
			DeveloperUserIDs: []int64{42},
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
		Name: "", CustomerLabel: "测试客户", Description: "y", Deadline: time.Now().Add(time.Hour),
		DeveloperUserIDs: []int64{42},
	})
	if !errors.Is(err, ErrProjectInvalidInput) {
		t.Errorf("err = %v；应返回 ErrProjectInvalidInput", err)
	}
}

// finding #9：Create 拒绝负数 originalQuote
//
// 业务背景：OAS Money pattern 历史允许负数；POST /api/projects 时
// 客户端传 originalQuote=-100 可在 DB 写入负值报价。Service 层拦截。
func TestCreate_RejectsNegativeOriginalQuote(t *testing.T) {
	svc := &ProjectServiceImpl{pool: nil}
	deadline := time.Now().Add(7 * 24 * time.Hour)
	negQuote, err := progressdb.MoneyFromString("-100.00")
	if err != nil {
		t.Fatalf("MoneyFromString -100.00: %v", err)
	}
	_, err = svc.Create(context.Background(), 100, 3 /* cs */, CreateProjectInput{
		Name: "x", CustomerLabel: "测试客户", Description: "y", Deadline: deadline,
		DeveloperUserIDs: []int64{42},
		OriginalQuote:    negQuote,
	})
	if !errors.Is(err, ErrProjectInvalidInput) {
		t.Errorf("err = %v；应返回 ErrProjectInvalidInput（拒绝负数报价）", err)
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
// ProjectStatus enum 一致性：8 状态对齐 oas（2026-05-04 删 dealing 后）
// ============================================================

func TestProjectStatusEnumConsistency(t *testing.T) {
	want := []oas.ProjectStatus{
		oas.ProjectStatusQuoting,
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
