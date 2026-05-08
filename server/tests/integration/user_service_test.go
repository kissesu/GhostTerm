/*
@file user_service_test.go
@description UserService 密码长度策略测试 —— finding #18 配套：
             - Create：密码 < 8 字节必拒
             - Update：传入新密码 < 8 字节必拒
             与 auth_service.ChangePassword 已有的 8 位下限对齐，
             修复"创建/重置密码 6 位 vs 改密 8 位"反向规则。
@author Atlas.oi
@date 2026-05-08
*/

package integration

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"github.com/ghostterm/progress-server/internal/services"
	"github.com/ghostterm/progress-server/internal/testutil"
)

// setupUserSvc 启 PG 容器 + 构造 UserService。bcrypt MinCost(=4) 让单测 < 1s。
func setupUserSvc(t *testing.T) services.UserService {
	t.Helper()
	pool, cleanup := testutil.StartPostgres(t)
	t.Cleanup(cleanup)

	svc, err := services.NewUserService(services.UserServiceDeps{
		Pool:       pool,
		BcryptCost: bcrypt.MinCost,
	})
	require.NoError(t, err)
	return svc
}

// ------------------------------------------------------------
// Create：密码长度门槛
// ------------------------------------------------------------

func TestUserService_Create_RejectsShortPassword(t *testing.T) {
	svc := setupUserSvc(t)
	ctx := context.Background()

	// 7 字节，低于 minPasswordLen(=8)，必须被拒绝
	_, err := svc.Create(ctx, services.UserCreateInput{
		Username: "alice-short-pwd",
		Password: "1234567",
		RoleID:   2, // 开发角色
	})
	require.Error(t, err)
	require.ErrorIs(t, err, services.ErrInvalidUserInput,
		"短密码必须返 ErrInvalidUserInput")
	require.Contains(t, err.Error(), "8",
		"错误信息应明确提示最小长度 8")
}

func TestUserService_Create_AcceptsMinLengthPassword(t *testing.T) {
	svc := setupUserSvc(t)
	ctx := context.Background()

	// 恰好 8 字节，必须通过（边界值不能误拒）
	_, err := svc.Create(ctx, services.UserCreateInput{
		Username: "alice-min-pwd",
		Password: "12345678",
		RoleID:   2,
	})
	require.NoError(t, err)
}

// ------------------------------------------------------------
// Update：改密时长度门槛（plan 中称 ResetPassword，实际入口是 Update.Password）
// ------------------------------------------------------------

func TestUserService_Update_RejectsShortPassword(t *testing.T) {
	svc := setupUserSvc(t)
	ctx := context.Background()

	// 先创一个用户，再尝试用短密码 Update
	created, err := svc.Create(ctx, services.UserCreateInput{
		Username: "bob-update-pwd",
		Password: "initialPassword",
		RoleID:   2,
	})
	require.NoError(t, err)

	short := "abcdefg" // 7 字节
	_, err = svc.Update(ctx, created.ID, services.UserUpdateInput{
		Password: &short,
	})
	require.Error(t, err)
	require.ErrorIs(t, err, services.ErrInvalidUserInput,
		"短密码 Update 必须返 ErrInvalidUserInput")
	require.Contains(t, err.Error(), "8")
}
