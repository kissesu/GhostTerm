// @file cipher_service.go
// @description pgcrypto 列级加密 wrapper —— 包装 pgp_sym_encrypt/pgp_sym_decrypt
//              + HKDF-SHA256 派生每列独立子密钥（限制单列泄露面）。
//
//              业务背景（finding #4 列级加密）：
//                - feedbacks.content / payments.remark 包含客户敏感对话内容与款项备注
//                - 云厂商 SRE 直读 PG data 目录可见明文 → 列级加密让落盘密文
//                - 用 PG 端 pgp_sym_encrypt 而不是 Go 端 AES-GCM 是因为：
//                  view (project_activity_view) 仍要保留 content/remark 字段名出现在 jsonb，
//                  PG 端加密后下游 SELECT 仍能 encode(bytea, 'base64') 嵌入 jsonb，
//                  service 层拿到再统一解密；与 Path B 设计对齐
//                - HKDF info=ghostterm-v1:<column_name> 让"feedbacks.content 泄露"
//                  不会让"payments.remark"也连带破解（每列独立子密钥）
//
//              主密钥来源：
//                - 生产：env GT_DATA_KEY ≥32 字节，由 docker secret/.env 注入
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
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/hkdf"
)

const (
	// minMasterKeyLen 主密钥最小字节数。
	//
	// 业务背景：HKDF-SHA256 输出 32 字节子密钥；主密钥 < 32 字节让暴破成本远低于
	// 子密钥强度，相当于在 32 位锁链中夹一个 8 位环。32 字节是熵下限，强烈建议
	// 用 `openssl rand -base64 32` 之类生成而非人工挑选。
	minMasterKeyLen = 32

	// derivedKeyLen 每列子密钥长度（HKDF 扩展输出长度），与 SHA-256 输出宽度一致。
	derivedKeyLen = 32

	// hkdfInfoPrefix HKDF info 字段的命名空间前缀。
	//
	// 业务背景：info 是 HKDF 的"上下文绑定"参数，让"同主密钥不同 info"派生出
	// 完全无关的子密钥。前缀加版本号 v1，让未来可能的密钥派生算法升级（v2）
	// 与现存数据兼容（v1 数据用 v1 info 解密，v2 数据用 v2 info 解密）。
	hkdfInfoPrefix = "ghostterm-v1:"
)

// ErrCipherKeyNotConfigured 主密钥未配置或长度不足。
//
// 业务背景：让 cmd/server/main.go 启动期 fail-fast 时拿到稳定 sentinel，
// 而不是一段 fmt.Errorf 字符串（便于运维识别"配置缺失"vs"PG 错误"）。
var ErrCipherKeyNotConfigured = errors.New("cipher: master key not configured")

// CipherService 列级加密包装。
//
// 字段：
//   - db        ：pgxpool，用 PG 端 pgp_sym_encrypt/decrypt 函数
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

// deriveKey 用 HKDF-SHA256 + info=<prefix><columnName> 派生 32 字节子密钥并 base64 编码。
//
// 业务背景：HKDF 把"长且高熵但格式不固定的主密钥"扩展为"固定长度且 info 绑定"的
// 子密钥；同主密钥不同 columnName 得到无关子密钥。pgp_sym_encrypt 的 password 参数
// 是 TEXT，PG 客户端协议会按 UTF-8 校验；HKDF 输出的 32 raw 字节几乎必然包含非法
// UTF-8 字节序列，会被 PG 拒绝（"invalid byte sequence for encoding"）。
// 用 base64 std encoding 把 raw 子密钥编码成 ASCII 字符串再传给 pgp_sym_encrypt，
// 等价于一个 44 字符高熵 password（base64(32 字节) = 44 字符），强度无损。
func (s *CipherService) deriveKey(columnName string) string {
	info := []byte(hkdfInfoPrefix + columnName)
	h := hkdf.New(sha256.New, s.masterKey, nil, info)
	derived := make([]byte, derivedKeyLen)
	// HKDF.Read 在请求 <= hash size 时不会返错误（依文档），忽略 err 不需 panic
	_, _ = h.Read(derived)
	return base64.StdEncoding.EncodeToString(derived)
}

// Encrypt 用列绑定子密钥对 plaintext 加密，返回 BYTEA 密文（pgp_sym_encrypt 输出）。
//
// 业务约定：
//   - plaintext == "" → 返 []byte{} 不调 PG（节省一次 round-trip）
//   - 否则走 SELECT pgp_sym_encrypt(plaintext, derivedKey) 单语句返回 bytea
//   - 同 plaintext 多次 Encrypt 因 pgp_sym_encrypt 内部随机 IV 不会得到相同密文，
//     这是非确定性加密的预期行为（防止"密文相同 = 明文相同"的频率分析）
func (s *CipherService) Encrypt(ctx context.Context, columnName, plaintext string) ([]byte, error) {
	if plaintext == "" {
		return []byte{}, nil
	}
	derived := s.deriveKey(columnName)
	var ciphertext []byte
	if err := s.db.QueryRow(ctx,
		`SELECT pgp_sym_encrypt($1, $2)`,
		plaintext, derived,
	).Scan(&ciphertext); err != nil {
		return nil, fmt.Errorf("cipher: pgp_sym_encrypt %s: %w", columnName, err)
	}
	return ciphertext, nil
}

// Decrypt 用列绑定子密钥解密 BYTEA 密文。
//
// 业务约定：
//   - len(ciphertext) == 0 → 返 ""（兼容空记录场景）
//   - PG 解密失败（密文损坏 / 用错列子密钥 / 主密钥不一致）→ 透出 PG 错给 caller
//     让上层日志/告警感知，不做 silent fallback 返空字符串（违反 first-principles
//     "禁止降级回退"）
func (s *CipherService) Decrypt(ctx context.Context, columnName string, ciphertext []byte) (string, error) {
	if len(ciphertext) == 0 {
		return "", nil
	}
	derived := s.deriveKey(columnName)
	var plaintext string
	if err := s.db.QueryRow(ctx,
		`SELECT pgp_sym_decrypt($1, $2)`,
		ciphertext, derived,
	).Scan(&plaintext); err != nil {
		return "", fmt.Errorf("cipher: pgp_sym_decrypt %s: %w", columnName, err)
	}
	return plaintext, nil
}
