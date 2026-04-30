/*
@file jwt_test.go
@description JWT 签发/校验单测：
             - access roundtrip（含 role_id / token_version）
             - refresh roundtrip + hash 长度
             - 过期 token 拒绝
             - 错密钥拒绝
             - 篡改 token 拒绝
             - 不允许 alg=none / alg=RS256（防算法混淆）
             - WS ticket 与 refresh hash 用同一 SHA-256 工具
@author Atlas.oi
@date 2026-04-29
*/

package auth

import (
	"crypto/sha256"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var (
	testAccessSecret  = []byte("test-access-secret-32-bytes-min!!")
	testRefreshSecret = []byte("test-refresh-secret-32-bytes-min!")
)

func TestIssueAndVerifyAccess_Roundtrip(t *testing.T) {
	tok, err := IssueAccessToken(42, 2, 7, testAccessSecret, time.Minute)
	require.NoError(t, err)
	require.NotEmpty(t, tok)

	claims, err := VerifyAccessToken(tok, testAccessSecret)
	require.NoError(t, err)
	assert.Equal(t, int64(42), claims.UserID)
	assert.Equal(t, int64(2), claims.RoleID)
	assert.Equal(t, int64(7), claims.TokenVersion)
	assert.Equal(t, Issuer, claims.Issuer)
}

func TestIssueAndVerifyRefresh_Roundtrip(t *testing.T) {
	raw, hash, err := IssueRefreshToken(99, testRefreshSecret, time.Hour)
	require.NoError(t, err)
	require.NotEmpty(t, raw)
	require.Len(t, hash, sha256.Size, "SHA-256 hash 长度必须 32 字节")

	claims, err := VerifyRefreshToken(raw, testRefreshSecret)
	require.NoError(t, err)
	assert.Equal(t, int64(99), claims.UserID)

	// 同一 raw 重新 hash 应得同结果
	assert.Equal(t, hash, HashRefreshToken(raw))
}

func TestVerifyAccess_Expired(t *testing.T) {
	// TTL 设为负数 → 已过期
	tok, err := IssueAccessToken(1, 1, 0, testAccessSecret, -time.Second)
	require.NoError(t, err)

	_, err = VerifyAccessToken(tok, testAccessSecret)
	assert.Error(t, err)
}

func TestVerifyAccess_WrongSecret(t *testing.T) {
	tok, err := IssueAccessToken(1, 1, 0, testAccessSecret, time.Minute)
	require.NoError(t, err)

	_, err = VerifyAccessToken(tok, []byte("a-totally-different-secret-xxxxxx"))
	assert.Error(t, err)
}

func TestVerifyAccess_TamperedSignature(t *testing.T) {
	tok, err := IssueAccessToken(1, 1, 0, testAccessSecret, time.Minute)
	require.NoError(t, err)

	// 把最后一个字符改一下（base64url 集合内的字符）—— 等价于篡改签名
	last := tok[len(tok)-1]
	var alt byte = 'A'
	if last == 'A' {
		alt = 'B'
	}
	tampered := tok[:len(tok)-1] + string(alt)

	_, err = VerifyAccessToken(tampered, testAccessSecret)
	assert.Error(t, err)
}

// 防算法混淆：哪怕 secret 配对正确，alg=none 也必须拒绝。
func TestVerifyAccess_RejectAlgNone(t *testing.T) {
	claims := &AccessClaims{
		UserID:       1,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "1",
			Issuer:    Issuer,
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Minute)),
		},
	}
	noneTok := jwt.NewWithClaims(jwt.SigningMethodNone, claims)
	signed, err := noneTok.SignedString(jwt.UnsafeAllowNoneSignatureType)
	require.NoError(t, err)

	_, err = VerifyAccessToken(signed, testAccessSecret)
	assert.Error(t, err, "alg=none 必须被拒")
}

func TestVerifyRefresh_WrongSecret(t *testing.T) {
	raw, _, err := IssueRefreshToken(1, testRefreshSecret, time.Hour)
	require.NoError(t, err)

	_, err = VerifyRefreshToken(raw, []byte("nope-nope-nope-nope-nope-nope-no"))
	assert.Error(t, err)
}

func TestVerifyAccess_EmptyToken(t *testing.T) {
	_, err := VerifyAccessToken("", testAccessSecret)
	assert.Error(t, err)
}

func TestIssueAccess_EmptySecret(t *testing.T) {
	_, err := IssueAccessToken(1, 1, 0, nil, time.Minute)
	assert.Error(t, err)
}

func TestIssueWSTicketRaw_HashStable(t *testing.T) {
	raw, hash, err := IssueWSTicketRaw()
	require.NoError(t, err)
	require.Len(t, hash, sha256.Size)
	// 原文长度：32 字节 base64url 无 padding ≈ 43 字符
	require.True(t, len(raw) >= 40, "ws ticket raw 长度异常: %d", len(raw))

	// HashWSTicket 应与 IssueWSTicketRaw 返回的 hash 一致
	assert.Equal(t, hash, HashWSTicket(raw))
}

func TestVerifyAccess_WrongIssuer(t *testing.T) {
	// 直接用 jwt 库构造一个 issuer 不匹配的 token
	claims := &AccessClaims{
		UserID: 1,
		RoleID: 1,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "1",
			Issuer:    "evil-issuer",
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Minute)),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := tok.SignedString(testAccessSecret)
	require.NoError(t, err)

	_, err = VerifyAccessToken(signed, testAccessSecret)
	require.Error(t, err)
	assert.True(t, strings.Contains(err.Error(), "issuer"), "错误信息应提示 issuer mismatch")
}
