/*
@file jwt.go
@description JWT 签发与校验封装。
             双密钥模型（Lead 决策）：
               - access token 用 JWTAccessSecret 签，TTL 短（默认 15min）
               - refresh token 用 JWTRefreshSecret 签，TTL 长（默认 168h）
             Refresh token 同时把 SHA-256 hash 持久化到 refresh_tokens 表，
             配合 rotate_refresh_token SECURITY DEFINER 函数做"原子轮转 + 重放检测"。
             所有 token 算法固定 HS256；本文件不允许 alg=none / RS256（防止算法混淆攻击）。
@author Atlas.oi
@date 2026-04-29
*/

package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Issuer 是 JWT iss claim 的固定值。
//
// 业务背景：spec §3.5 要求 token 必须显式 iss 以便日志审计区分本服务签发的 token；
// 若未来引入第二方 SSO，校验时拒绝 iss 不匹配的 token。
const Issuer = "ghostterm-progress"

// AccessClaims 是 access token 的 payload。
//
// 字段语义：
//   - UserID: users.id（string，jwt.RegisteredClaims.Subject）
//   - RoleID: users.role_id，便于中间件不查 DB 即可判断角色
//   - TokenVersion: users.token_version 当前值，logout-all 时递增使旧 token 失效
type AccessClaims struct {
	UserID       int64 `json:"-"`
	RoleID       int64 `json:"role_id"`
	TokenVersion int64 `json:"token_version"`
	jwt.RegisteredClaims
}

// RefreshClaims 是 refresh token 的 payload。
//
// 业务背景：refresh token 不携带 role_id / token_version —— 因为 refresh 路径
// 不直接放行业务请求，必须先 rotate 后签发新 access；role/version 校验在 access 链路完成。
// 仅 sub + jti（用作"客户端持有的 token 标识"，与服务端 hash 无关）。
type RefreshClaims struct {
	UserID int64 `json:"-"`
	jwt.RegisteredClaims
}

// IssueAccessToken 签发 HS256 access token。
//
// 业务流程：
//  1. 构造 AccessClaims（sub/iat/exp/iss/role_id/token_version）
//  2. 用 NewWithClaims(SigningMethodHS256) 签名
//
// 设计取舍：
//   - sub 用 strconv.FormatInt(userID, 10)：jwt RegisteredClaims.Subject 类型是 string，
//     避免 int64 → float64 的 JSON 漂移
//   - 不 set NotBefore：iat 已隐含；jwt 库默认会在 ParseWithClaims 时校验 exp/iat
func IssueAccessToken(userID, roleID, tokenVersion int64, secret []byte, ttl time.Duration) (string, error) {
	if len(secret) == 0 {
		return "", errors.New("auth: access secret is empty")
	}
	now := time.Now()
	claims := &AccessClaims{
		UserID:       userID,
		RoleID:       roleID,
		TokenVersion: tokenVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   strconv.FormatInt(userID, 10),
			Issuer:    Issuer,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := tok.SignedString(secret)
	if err != nil {
		return "", fmt.Errorf("auth: sign access: %w", err)
	}
	return signed, nil
}

// IssueRefreshToken 生成 refresh token + 计算 SHA-256 hash 用于入库。
//
// 业务流程：
//  1. 用 crypto/rand 生成 32 字节随机 token id（jti），编为 base64url
//  2. 构造 RefreshClaims（sub/iat/exp/iss/jti）并 HS256 签名
//  3. 计算 SHA-256(signed) → bytea，作为 refresh_tokens.token_hash 入库
//
// 设计取舍：
//   - 完整签名串入库 hash 而非仅 jti：让 hash 兼具"签名值绑定"功能 ——
//     即使有人偷到 jti，也无法伪造同 hash 的 token（HS256 secret 必须正确）
//   - 用 SHA-256 而非 bcrypt：refresh hash 的查询是高频路径（每次 refresh），
//     bcrypt 太慢；token 本身已是 256 位随机熵 + HS256 签名，SHA-256 足够
func IssueRefreshToken(userID int64, secret []byte, ttl time.Duration) (string, []byte, error) {
	if len(secret) == 0 {
		return "", nil, errors.New("auth: refresh secret is empty")
	}
	jti, err := randomTokenID()
	if err != nil {
		return "", nil, err
	}
	now := time.Now()
	claims := &RefreshClaims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   strconv.FormatInt(userID, 10),
			Issuer:    Issuer,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
			ID:        jti,
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := tok.SignedString(secret)
	if err != nil {
		return "", nil, fmt.Errorf("auth: sign refresh: %w", err)
	}
	hash := sha256Bytes(signed)
	return signed, hash, nil
}

// VerifyAccessToken 校验 HS256 access token 并返回 claims。
//
// 业务流程：
//  1. ParseWithClaims：固定算法 HS256，alg 不匹配立即拒绝（防止 alg=none 攻击）
//  2. 解析 sub → UserID
//  3. 校验 iss = Issuer
//
// 注意：本函数不校验 token_version 是否与 DB 一致 ——
// 那是 service 层 VerifyAccessToken 的职责（要查 users 表）。
func VerifyAccessToken(raw string, secret []byte) (AccessClaims, error) {
	if raw == "" {
		return AccessClaims{}, errors.New("auth: empty access token")
	}
	claims := &AccessClaims{}
	tok, err := jwt.ParseWithClaims(raw, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected alg: %v", t.Header["alg"])
		}
		return secret, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
	if err != nil {
		return AccessClaims{}, fmt.Errorf("auth: parse access: %w", err)
	}
	if !tok.Valid {
		return AccessClaims{}, errors.New("auth: invalid access token")
	}
	if claims.Issuer != Issuer {
		return AccessClaims{}, errors.New("auth: issuer mismatch")
	}
	uid, err := strconv.ParseInt(claims.Subject, 10, 64)
	if err != nil {
		return AccessClaims{}, fmt.Errorf("auth: bad sub: %w", err)
	}
	claims.UserID = uid
	return *claims, nil
}

// VerifyRefreshToken 校验 HS256 refresh token 并返回 claims。
//
// 注意：仅做"签名 + iss + exp"层面校验；是否已被 rotate / 是否被 revoke
// 由 service 层用 token_hash 去 refresh_tokens 表查（rotate_refresh_token 函数原子完成）。
func VerifyRefreshToken(raw string, secret []byte) (RefreshClaims, error) {
	if raw == "" {
		return RefreshClaims{}, errors.New("auth: empty refresh token")
	}
	claims := &RefreshClaims{}
	tok, err := jwt.ParseWithClaims(raw, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected alg: %v", t.Header["alg"])
		}
		return secret, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
	if err != nil {
		return RefreshClaims{}, fmt.Errorf("auth: parse refresh: %w", err)
	}
	if !tok.Valid {
		return RefreshClaims{}, errors.New("auth: invalid refresh token")
	}
	if claims.Issuer != Issuer {
		return RefreshClaims{}, errors.New("auth: issuer mismatch")
	}
	uid, err := strconv.ParseInt(claims.Subject, 10, 64)
	if err != nil {
		return RefreshClaims{}, fmt.Errorf("auth: bad sub: %w", err)
	}
	claims.UserID = uid
	return *claims, nil
}

// IssueWSTicketRaw 生成短期 WS ticket 原文 + SHA-256 hash。
//
// 业务背景（part1 §C6 / spec §3.5）：
//   - 浏览器 WebSocket 不支持 Authorization header，必须用 query string ?ticket=...
//   - ticket 是一次性短期凭证（默认 30s 在 service 层指定 ttl）
//   - DB 只存 hash，原文返回给客户端；consume_ws_ticket(hash) 校验时一次性消费
//
// 设计：与 refresh token 不同，ticket 不是 JWT —— 它没有携带 claims 的需求，
// 仅作为"已登录用户能换 WS 连接"的随机凭证；hash 入库即可。
// 取 32 字节（256 bit）熵足够防暴力枚举。
func IssueWSTicketRaw() (string, []byte, error) {
	raw, err := randomTokenID()
	if err != nil {
		return "", nil, err
	}
	return raw, sha256Bytes(raw), nil
}

// HashWSTicket 计算 ticket 原文的 SHA-256（用于查询/校验）。
func HashWSTicket(raw string) []byte {
	return sha256Bytes(raw)
}

// HashRefreshToken 计算 refresh token 原文的 SHA-256（用于 rotate / revoke）。
func HashRefreshToken(raw string) []byte {
	return sha256Bytes(raw)
}

// randomTokenID 生成 base64url 编码的 32 字节随机串（无 padding，URL/路径安全）。
//
// 长度：32 字节 = 256 bit 熵，远超暴力枚举可行域；编码后约 43 字符。
func randomTokenID() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("auth: read random: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// sha256Bytes 计算 SHA-256 摘要，返回原始 32 字节切片（用作 BYTEA 入库）。
func sha256Bytes(s string) []byte {
	sum := sha256.Sum256([]byte(s))
	return sum[:]
}
