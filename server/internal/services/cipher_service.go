// @file cipher_service.go
// @description 列级加密 wrapper —— v2 用 Go 端 AES-256-GCM；v1 (pgcrypto)
//              仅用于解密历史数据（落库前 PR review C3 修复前的 finding #4 数据）。
//
//              业务背景（finding #4 列级加密）：
//                - feedbacks.content / payments.remark 包含客户敏感对话与款项备注
//                - 云厂商 SRE 直读 PG data 目录可见明文 → 列级加密让落盘密文
//                - HKDF info=ghostterm-v1:<column_name> 让"feedbacks.content 泄露"
//                  不会让"payments.remark"也连带破解（每列独立子密钥）
//
//              安全 review C3 修复（PR-3 review feedback）：
//                v1 (pgcrypto) Encrypt/Decrypt 把派生子密钥通过 pgxpool bind 参数
//                传入：`SELECT pgp_sym_encrypt($1, $2)` 中 $2 是 base64(HKDF) key。
//                若 PG 配 log_statement='all' / auto_explain.log_parameter_max_length>0
//                / pg_stat_statements.track=all，bind value 写入 PG 日志或视图，
//                DBA / 集中日志收集者直接拿到所有列子密钥 → 与 finding #5
//                "secrets 不落云盘"防御逻辑相悖。
//
//                v2 (本文件) 改 Go 端 AES-256-GCM：
//                - 主密钥 + 派生子密钥都不离开进程内存
//                - 不依赖 PG 函数调用，零 bind 参数泄露面
//                - 密文以 prefix byte 0x02 开头，与 v1 pgcrypto 输出 0xc3 互不冲突
//                - Decrypt 自动按 prefix 路由：v2 → Go GCM；其他 → v1 pgcrypto fallback
//                  让历史落库的 v1 密文仍可读，不破生产
//
//                Backfill 路径（运维行动项）：
//                  下次维护窗口跑 backfill 脚本：SELECT id, content FROM feedbacks
//                  WHERE substring(content_encrypted from 1 for 1) <> '\x02'
//                  → service.Decrypt → service.Encrypt → UPDATE。完成后历史 v1 全转 v2，
//                  可考虑下线 decryptV1Legacy 路径（finding #4 follow-up task）。
//
//              主密钥来源：
//                - 生产：systemd-creds 注入 GT_DATA_KEY ≥32 字节
//                - 测试：testutil 注入固定 32 字节字符串
//                - 主密钥泄露 = 全列密文均可解；轮换需重新加密历史数据（v1 不实现轮换流程）
//
//              空值约定：
//                - plaintext == "" 时 Encrypt 返 []byte{}（保 NOT NULL 列可写入"空记录"语义）
//                - ciphertext 为空 []byte 时 Decrypt 返 ""（兼容 BYTEA 长度 0 与 NULL 解析）
//                - NULL bytea 列由 caller 自行处理（payments.remark 在 0023 之后 NOT NULL，
//                  feedbacks.content 一直 NOT NULL，本 service 不处理 NULL 兜底）
//
// @author Atlas.oi
// @date 2026-05-08

package services

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/hkdf"
)

const (
	// minMasterKeyLen 主密钥最小字节数。
	//
	// HKDF-SHA256 输出 32 字节子密钥；主密钥 < 32 字节让暴破成本远低于子密钥强度。
	// 强烈建议用 `openssl rand -base64 32` 之类生成而非人工挑选。
	minMasterKeyLen = 32

	// derivedKeyLen 每列子密钥长度（HKDF 扩展输出长度），与 SHA-256 输出宽度一致。
	derivedKeyLen = 32

	// hkdfInfoPrefix HKDF info 字段的命名空间前缀。
	//
	// info 是 HKDF "上下文绑定" 参数，让 "同主密钥不同 info" 派生出完全无关的子密钥。
	// 前缀加版本号 v1，让未来可能的密钥派生算法升级（v2）与现存数据兼容
	// （注意：这里 v1 指的是 HKDF info schema 版本，与下方 cipherFormatV2 是独立维度）
	hkdfInfoPrefix = "ghostterm-v1:"

	// cipherFormatV2 是 v2 (Go AES-256-GCM) 密文的第一个字节标识。
	//
	// 选 0x02 的理由：v1 pgcrypto pgp_sym_encrypt 输出以 0xc3 开头（PGP message marker），
	// 与 0x02 不冲突；ASCII 控制字符 0x02 (STX) 在合法 plaintext 不会作为 ciphertext 首字节。
	// Decrypt 用 ciphertext[0] == 0x02 路由 v2 / 否则 fallback v1 pgcrypto。
	cipherFormatV2 byte = 0x02

	// gcmNonceLen GCM nonce 长度，标准 12 字节。
	gcmNonceLen = 12
)

// ErrCipherKeyNotConfigured 主密钥未配置或长度不足。
//
// 让 cmd/server/main.go 启动期 fail-fast 时拿到稳定 sentinel，
// 便于运维识别"配置缺失"vs"PG 错误"。
var ErrCipherKeyNotConfigured = errors.New("cipher: master key not configured")

// CipherService 列级加密包装。
//
// 字段：
//   - db        ：pgxpool，仅用于 v1 fallback 解密历史数据；v2 不走 PG
//   - masterKey ：主密钥；长度 >= 32 字节由构造函数把关，运行时不再校验
type CipherService struct {
	db        *pgxpool.Pool
	masterKey []byte
}

// NewCipherService 构造 CipherService。
//
// 业务流程：
//  1. 校验 db 与 masterKey 非 nil / 非空
//  2. 校验 masterKey >= minMasterKeyLen 字节
//  3. 复制 masterKey 切片防止外部 mutation 影响内部状态
func NewCipherService(db *pgxpool.Pool, masterKey []byte) (*CipherService, error) {
	if db == nil {
		return nil, errors.New("cipher: db pool is required")
	}
	if len(masterKey) < minMasterKeyLen {
		return nil, fmt.Errorf("cipher: master key must be >=%d bytes, got %d", minMasterKeyLen, len(masterKey))
	}
	// 复制一份避免 caller 后续修改外部 slice 引发难以排查的密文不一致
	keyCopy := make([]byte, len(masterKey))
	copy(keyCopy, masterKey)
	return &CipherService{db: db, masterKey: keyCopy}, nil
}

// deriveKey 用 HKDF-SHA256 + info=<prefix><columnName> 派生 32 字节子密钥（raw bytes）。
//
// 同主密钥不同 columnName 得到无关子密钥（用于 AES-256 key）。v2 路径直接消费 raw 字节，
// 不需要 base64 编码（不再走 PG TEXT 协议）。
func (s *CipherService) deriveKey(columnName string) []byte {
	info := []byte(hkdfInfoPrefix + columnName)
	h := hkdf.New(sha256.New, s.masterKey, nil, info)
	derived := make([]byte, derivedKeyLen)
	// HKDF.Read 在请求 <= hash size 时不会返错误（依文档），忽略 err 不需 panic
	_, _ = h.Read(derived)
	return derived
}

// Encrypt 用 v2 (AES-256-GCM) 加密，返回 [0x02 || nonce(12B) || ciphertext+tag(16B)]。
//
// 业务约定：
//   - plaintext == "" → 返 []byte{} 不做加密（保留空记录语义）
//   - 同 plaintext 多次 Encrypt 因 nonce 随机不会得到相同密文（防频率分析）
//   - 永远走 v2；v1 (pgcrypto) Encrypt 已下线（C3 修复后新写入 0 走 PG bind path）
func (s *CipherService) Encrypt(_ context.Context, columnName, plaintext string) ([]byte, error) {
	if plaintext == "" {
		return []byte{}, nil
	}
	key := s.deriveKey(columnName)
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("cipher: aes new %s: %w", columnName, err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("cipher: gcm new %s: %w", columnName, err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("cipher: rand nonce %s: %w", columnName, err)
	}
	sealed := gcm.Seal(nil, nonce, []byte(plaintext), nil)
	out := make([]byte, 0, 1+len(nonce)+len(sealed))
	out = append(out, cipherFormatV2)
	out = append(out, nonce...)
	out = append(out, sealed...)
	return out, nil
}

// Decrypt 按密文 prefix 路由：
//   - 第一字节 0x02 → v2 Go AES-GCM（标准路径，C3 修复后所有新数据）
//   - 否则 → v1 pgcrypto fallback（兼容历史落库）
//
// caller 看到的对外语义不变：传 ciphertext 拿 plaintext，本服务自动选格式。
func (s *CipherService) Decrypt(ctx context.Context, columnName string, ciphertext []byte) (string, error) {
	if len(ciphertext) == 0 {
		return "", nil
	}
	if ciphertext[0] == cipherFormatV2 {
		return s.decryptV2(columnName, ciphertext)
	}
	return s.decryptV1Legacy(ctx, columnName, ciphertext)
}

// decryptV2 解 v2 AES-256-GCM 密文。
//
// 密文格式：[0x02 || nonce(12B) || ciphertext+tag]
// 最小长度 = 1 (prefix) + 12 (nonce) + 16 (GCM tag) = 29 字节。
func (s *CipherService) decryptV2(columnName string, ciphertext []byte) (string, error) {
	const minLen = 1 + gcmNonceLen + 16 // prefix + nonce + GCM tag
	if len(ciphertext) < minLen {
		return "", fmt.Errorf("cipher: v2 ciphertext too short %s: %d < %d", columnName, len(ciphertext), minLen)
	}
	key := s.deriveKey(columnName)
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("cipher: aes new %s: %w", columnName, err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("cipher: gcm new %s: %w", columnName, err)
	}
	nonce := ciphertext[1 : 1+gcmNonceLen]
	payload := ciphertext[1+gcmNonceLen:]
	pt, err := gcm.Open(nil, nonce, payload, nil)
	if err != nil {
		return "", fmt.Errorf("cipher: gcm open %s: %w", columnName, err)
	}
	return string(pt), nil
}

// decryptV1Legacy 用 pgcrypto 解密历史 v1 (pgp_sym_encrypt) 密文。
//
// 安全 review C3 警告：本路径仍把 base64 子密钥通过 PG bind 参数传输；
// 若 PG 配 log_statement='all' / pg_stat_statements.track=all，bind value
// 仍可能进 PG 日志泄露 key。这是为兼容历史落库数据保留的 fallback。
//
// Follow-up 行动项（运维）：
//   - 跑 backfill 脚本把所有 v1 密文 (prefix 0xc3) 解密 + v2 重加密
//   - 完成后下线本函数（删除 db 字段依赖）
//   - 直至 backfill 完成前必须确保生产 PG 配置：
//   - log_statement = 'none' 或 'ddl'（禁 'all'）
//   - pg_stat_statements 关闭或 track <> 'all'
//   - 启动期 fail-fast 校验由 cmd/server/main.go 实施（PR-3 review H1）
func (s *CipherService) decryptV1Legacy(ctx context.Context, columnName string, ciphertext []byte) (string, error) {
	derived := base64.StdEncoding.EncodeToString(s.deriveKey(columnName))
	var plaintext string
	if err := s.db.QueryRow(ctx,
		`SELECT pgp_sym_decrypt($1, $2)`,
		ciphertext, derived,
	).Scan(&plaintext); err != nil {
		return "", fmt.Errorf("cipher: pgp_sym_decrypt v1 fallback %s: %w", columnName, err)
	}
	return plaintext, nil
}
