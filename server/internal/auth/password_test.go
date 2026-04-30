/*
@file password_test.go
@description bcrypt 哈希/校验单测：
             - 正反 roundtrip
             - 错密码拒绝
             - 空字符串拒绝
             - 超 72 字节拒绝
             - 非法 hash 串校验返回 false（不 panic）
@author Atlas.oi
@date 2026-04-29
*/

package auth

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
)

func TestHashPassword_Roundtrip(t *testing.T) {
	// 用 MinCost(=4) 让测试快；生产 cost 由 config 注入
	hash, err := HashPassword("correct horse battery staple", bcrypt.MinCost)
	require.NoError(t, err)
	assert.NotEmpty(t, hash)

	// 同一密码的两次 hash 应不同（bcrypt 自带随机 salt）
	hash2, err := HashPassword("correct horse battery staple", bcrypt.MinCost)
	require.NoError(t, err)
	assert.NotEqual(t, hash, hash2, "salt 应让两次哈希不同")
}

func TestVerifyPassword_Match(t *testing.T) {
	hash, err := HashPassword("s3cret", bcrypt.MinCost)
	require.NoError(t, err)
	assert.True(t, VerifyPassword("s3cret", hash))
}

func TestVerifyPassword_Mismatch(t *testing.T) {
	hash, err := HashPassword("s3cret", bcrypt.MinCost)
	require.NoError(t, err)
	assert.False(t, VerifyPassword("wrong", hash), "错密码必须返回 false")
}

func TestHashPassword_Empty(t *testing.T) {
	_, err := HashPassword("", bcrypt.MinCost)
	assert.Error(t, err)
}

func TestHashPassword_TooLong(t *testing.T) {
	long := strings.Repeat("a", 73)
	_, err := HashPassword(long, bcrypt.MinCost)
	assert.ErrorIs(t, err, ErrPasswordTooLong)
}

func TestVerifyPassword_EmptyInputs(t *testing.T) {
	// 空 plain 或 空 hash 都应返回 false（不 panic / 不 error 上抛）
	assert.False(t, VerifyPassword("", ""))
	assert.False(t, VerifyPassword("x", ""))
	assert.False(t, VerifyPassword("", "x"))
}

func TestVerifyPassword_GarbageHash(t *testing.T) {
	// 非法 bcrypt 串应当被识别为 false 而非崩溃 / 5xx
	assert.False(t, VerifyPassword("anything", "not-a-bcrypt-hash"))
}
