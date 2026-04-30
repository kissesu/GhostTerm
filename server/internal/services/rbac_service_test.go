/*
@file rbac_service_test.go
@description RBACService 的单元测试 —— 覆盖纯逻辑分支：
             - HasPermission 通配 / 完全匹配 / 半通配（resource:* 或 *:action）/ 不匹配
             - splitPerm 边界（空、缺冒号、多冒号）
             - VisibilityFilter 永远返回 ("TRUE", nil, nil)（v2 改 RLS 后的占位）
             - cacheEntry 过期后失效

             不在本文件做：
             - DB 集成测试（HasPermission 真实查 role_permissions）放 tests/integration/rbac_test.go
@author Atlas.oi
@date 2026-04-29
*/

package services

import (
	"testing"
	"time"
)

// ============================================================
// splitPerm
// ============================================================

func TestSplitPerm(t *testing.T) {
	cases := []struct {
		in       string
		wantRes  string
		wantAct  string
	}{
		{"project:read", "project", "read"},
		{"event:E10", "event", "E10"},
		{"customer:create", "customer", "create"},
		{":read", "", "read"},                // resource 空
		{"project:", "project", ""},          // action 空
		{"noColon", "", ""},                  // 缺冒号
		{"", "", ""},                         // 空字符串
		{"a:b:c", "a", "b:c"},                // 多冒号：以第一个冒号分割
	}
	for _, c := range cases {
		gotRes, gotAct := splitPerm(c.in)
		if gotRes != c.wantRes || gotAct != c.wantAct {
			t.Errorf("splitPerm(%q) = (%q,%q); want (%q,%q)",
				c.in, gotRes, gotAct, c.wantRes, c.wantAct)
		}
	}
}

// ============================================================
// HasPermission：用本地 stub 缓存绕过 DB
// ============================================================

// makeStubService 构造一个 rbacService，并直接把"已 DB 加载完成"的 perms 写入缓存，
// 这样 HasPermission 不会触碰 pool（pool 为 nil 也安全）。
func makeStubService(t *testing.T, roleID int64, perms map[string]bool) *rbacService {
	t.Helper()
	s := &rbacService{
		pool:     nil,
		cacheTTL: time.Hour,
	}
	s.storePermsToCache(roleID, perms)
	return s
}

func TestHasPermission_Wildcard(t *testing.T) {
	// 超管：通配 "*:*" → 任何 perm 都应通过
	svc := makeStubService(t, 1, map[string]bool{"*:*": true})

	for _, perm := range []string{"project:read", "event:E10", "customer:create", "anything:goes"} {
		ok, err := svc.HasPermission(nil, 999, 1, perm)
		if err != nil {
			t.Fatalf("HasPermission(%q): %v", perm, err)
		}
		if !ok {
			t.Errorf("超管 *:* 应放行 %q", perm)
		}
	}
}

func TestHasPermission_ExactMatch(t *testing.T) {
	svc := makeStubService(t, 3, map[string]bool{
		"project:read":   true,
		"customer:create": true,
	})

	cases := map[string]bool{
		"project:read":     true,  // 命中
		"customer:create":  true,  // 命中
		"customer:delete":  false, // resource 命中但 action 未授权
		"project:write":    false, // 未授权
		"event:E10":        false, // 未授权
	}
	for perm, want := range cases {
		got, err := svc.HasPermission(nil, 7, 3, perm)
		if err != nil {
			t.Fatalf("HasPermission(%q): %v", perm, err)
		}
		if got != want {
			t.Errorf("HasPermission(%q) = %v; want %v", perm, got, want)
		}
	}
}

func TestHasPermission_HalfWildcard(t *testing.T) {
	// 角色拥有 "project:*" 应放行所有 project 动作；
	// 反之 "*:read" 应放行所有资源的 read
	svc := makeStubService(t, 5, map[string]bool{
		"project:*": true,
		"*:read":    true,
	})

	cases := map[string]bool{
		"project:read":   true,  // project:* 命中
		"project:write":  true,  // project:* 命中
		"customer:read":  true,  // *:read 命中
		"event:read":     true,  // *:read 命中
		"customer:write": false, // 无任何匹配
	}
	for perm, want := range cases {
		got, err := svc.HasPermission(nil, 1, 5, perm)
		if err != nil {
			t.Fatalf("HasPermission(%q): %v", perm, err)
		}
		if got != want {
			t.Errorf("HasPermission(%q) = %v; want %v", perm, got, want)
		}
	}
}

func TestHasPermission_EmptyPerm(t *testing.T) {
	svc := makeStubService(t, 1, map[string]bool{"*:*": true})
	_, err := svc.HasPermission(nil, 1, 1, "")
	if err == nil {
		t.Error("空 perm 应返回 error")
	}
}

// ============================================================
// VisibilityFilter：v2 起恒返回 ("TRUE", nil, nil)
// ============================================================

func TestVisibilityFilter_AlwaysTrue(t *testing.T) {
	svc := &rbacService{cacheTTL: time.Hour}
	frag, args, err := svc.VisibilityFilter(nil, 42, 3, "project")
	if err != nil {
		t.Fatalf("VisibilityFilter err: %v", err)
	}
	if frag != "TRUE" {
		t.Errorf("VisibilityFilter() = %q; want TRUE（RLS 已承担行级过滤）", frag)
	}
	if args != nil {
		t.Errorf("VisibilityFilter args = %v; want nil", args)
	}
}

// ============================================================
// 缓存过期
// ============================================================

func TestCacheExpiry(t *testing.T) {
	svc := &rbacService{cacheTTL: 50 * time.Millisecond, pool: nil}
	svc.storePermsToCache(99, map[string]bool{"project:read": true})

	// 立刻读：应命中
	if got := svc.loadPermsFromCache(99); got == nil {
		t.Fatal("缓存未命中（应该刚写入）")
	}

	// 等过期 + 余量
	time.Sleep(80 * time.Millisecond)

	if got := svc.loadPermsFromCache(99); got != nil {
		t.Error("过期后应返回 nil")
	}
}

func TestCacheInvalidate(t *testing.T) {
	svc := &rbacService{cacheTTL: time.Hour, pool: nil}
	svc.storePermsToCache(7, map[string]bool{"event:E10": true})
	if got := svc.loadPermsFromCache(7); got == nil {
		t.Fatal("写入后应命中")
	}
	svc.InvalidateRole(7)
	if got := svc.loadPermsFromCache(7); got != nil {
		t.Error("Invalidate 后应失效")
	}
}

// ============================================================
// LoadUserPermissions：返回的 map 不能与缓存共享指针（防外部污染）
// ============================================================

func TestLoadUserPermissions_ReturnsCopy(t *testing.T) {
	svc := makeStubService(t, 2, map[string]bool{"project:read": true})
	out, err := svc.LoadUserPermissions(nil, 2)
	if err != nil {
		t.Fatalf("LoadUserPermissions: %v", err)
	}
	if !out["project:read"] {
		t.Fatal("应包含 project:read")
	}
	// 改 out 不应该影响下一次调用
	out["malicious:write"] = true
	out2, err := svc.LoadUserPermissions(nil, 2)
	if err != nil {
		t.Fatal(err)
	}
	if out2["malicious:write"] {
		t.Error("LoadUserPermissions 必须返回 map 副本，外部改动不应污染缓存")
	}
}

// ============================================================
// Permission.Code()
// ============================================================

func TestPermissionCode(t *testing.T) {
	p := Permission{Resource: "project", Action: "read", Scope: "member"}
	if p.Code() != "project:read" {
		t.Errorf("Code() = %q; want project:read", p.Code())
	}
}

// ============================================================
// NewRBACService: 必填校验 + 默认 TTL
// ============================================================

func TestNewRBACService_RequiresPool(t *testing.T) {
	_, err := NewRBACService(RBACServiceDeps{Pool: nil})
	if err == nil {
		t.Error("Pool=nil 应返回 error")
	}
}
