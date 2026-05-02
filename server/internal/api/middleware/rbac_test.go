/*
@file rbac_test.go
@description MatchPermission 单测（表驱动覆盖四档优先级 + 退化输入）。

业务背景：原 LoadEffectivePermissions / RequirePermission 中间件已删除（review §I1：
所有路由走 ogen，由 oasSecurityHandler 完成"鉴权 + 注入 perms"），故对应测试一并移除。
保留的 MatchPermission 仍被 oasSecurityHandler 之外的 handler 直接调用，必须密集覆盖。

@author Atlas.oi
@date 2026-05-02
*/

package middleware_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/ghostterm/progress-server/internal/api/middleware"
)

// MatchPermission 覆盖四档命中 + 异常输入。
//
// 业务背景：handler 内 checkPerm 直接调本函数；任何 bug 影响全权限模块，必须密集覆盖。
func TestRBAC_MatchPermission(t *testing.T) {
	type tc struct {
		name  string
		perms []string
		want  string
		ok    bool
	}
	cases := []tc{
		// 命中：四档优先级
		{name: "exact_match", perms: []string{"a:b:c"}, want: "a:b:c", ok: true},
		{name: "action_wildcard_scope", perms: []string{"a:b:*"}, want: "a:b:c", ok: true},
		{name: "resource_wildcard_full", perms: []string{"a:*:*"}, want: "a:b:c", ok: true},
		{name: "super_admin_global", perms: []string{"*:*"}, want: "a:b:c", ok: true},
		{name: "super_admin_global_with_others", perms: []string{"*:*", "x:y:z"}, want: "anything:goes:here", ok: true},

		// 不命中
		{name: "no_match_at_all", perms: []string{"x:y:z"}, want: "a:b:c", ok: false},
		{name: "wrong_resource_with_action_scope", perms: []string{"x:b:*"}, want: "a:b:c", ok: false},
		{name: "wrong_action_with_resource_full", perms: []string{"a:x:*"}, want: "a:b:c", ok: false},
		{name: "empty_perms", perms: []string{}, want: "a:b:c", ok: false},
		{name: "nil_perms", perms: nil, want: "a:b:c", ok: false},

		// 退化输入：want 非 3 段
		{name: "want_one_segment", perms: []string{"*:*"}, want: "broken", ok: false},
		{name: "want_two_segments", perms: []string{"*:*"}, want: "a:b", ok: false},
		{name: "want_four_segments", perms: []string{"*:*"}, want: "a:b:c:d", ok: false},
		{name: "want_empty_segment", perms: []string{"*:*"}, want: "a::c", ok: false},
		{name: "want_empty_string", perms: []string{"*:*"}, want: "", ok: false},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := middleware.MatchPermission(c.perms, c.want)
			assert.Equal(t, c.ok, got)
		})
	}
}
