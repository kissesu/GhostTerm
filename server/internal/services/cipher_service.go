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
//              key 版本（finding L7 follow-up，2026-05-09）：
//                Encrypt 返回 (ciphertext, keyVersion, err)；caller 把 keyVersion 与密文同写入
//                feedbacks.content_key_version / payments.remark_key_version 列。
//                Decrypt 接受 keyVersion 参数路由到对应的主密钥（当前仅 v=1）。
//                未来轮换：keyByVersion map 增 v=2 → currentKeyVersion=2 让新写走新 key；
//                老数据按 row 的 _key_version 列继续走 v=1。
//                设计取舍：keyVersion 是 int16 与 SMALLINT 列宽对齐；0 视为非法（=未初始化）。
//
// @author Atlas.oi
// @date 2026-05-09

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

	// CurrentKeyVersion 当前默认主密钥版本（finding L7 follow-up）。
	//
	// Encrypt 永远写入 v=CurrentKeyVersion；caller 把它一起写入 *_key_version 列。
	// 未来轮换主密钥时把这里改成 2，并在 keyByVersion map 中加入 v=2 主密钥；
	// 老 v=1 数据靠 row 的 _key_version 列继续走 v=1 解密路径。
	CurrentKeyVersion int16 = 1
)

// ErrCipherKeyNotConfigured 主密钥未配置或长度不足。
//
// 让 cmd/server/main.go 启动期 fail-fast 时拿到稳定 sentinel，
// 便于运维识别"配置缺失"vs"PG 错误"。
var ErrCipherKeyNotConfigured = errors.New("cipher: master key not configured")

// CipherService 列级加密包装。
//
// 字段：
//   - db            ：pgxpool，仅用于 v1 fallback 解密历史数据；v2 不走 PG
//   - keyByVersion  ：版本号 → 主密钥字节切片的映射；当前仅装 v=1。
//                     未来轮换时往 map 添加 v=2 主密钥，由 cmd/server/main.go 注入。
//   - currentVer    ：写入新数据时使用的版本号（=CurrentKeyVersion 默认值，可由测试覆盖）
type CipherService struct {
	db           *pgxpool.Pool
	keyByVersion map[int16][]byte
	currentVer   int16
}

// ErrCipherUnknownKeyVersion 解密时遇到未注册的 key 版本号。
//
// 业务背景：DB 中某行 _key_version=2 但应用启动时仅注入 v=1 主密钥（运维忘记滚配置）。
// 暴露错误而非降级返空字符串，让运维立刻发现配置漏。
var ErrCipherUnknownKeyVersion = errors.New("cipher: unknown key version")

// NewCipherService 构造 CipherService（兼容 v=1 单 key 模式）。
//
// 业务流程：
//  1. 校验 db 与 masterKey 非 nil / 非空
//  2. 校验 masterKey >= minMasterKeyLen 字节
//  3. 复制 masterKey 切片防止外部 mutation 影响内部状态
//  4. 把 masterKey 注册为 v=CurrentKeyVersion 的主密钥
//
// 设计取舍：
//   - 保留单参数构造让 cmd/server/main.go 与现有测试零改动
//   - 未来轮换时新增 NewCipherServiceWithVersions(db, keys map[int16][]byte) 路径
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
	return &CipherService{
		db:           db,
		keyByVersion: map[int16][]byte{CurrentKeyVersion: keyCopy},
		currentVer:   CurrentKeyVersion,
	}, nil
}

// deriveKey 用 HKDF-SHA256 + info=<prefix><columnName> 派生 32 字节子密钥（raw bytes）。
//
// 同主密钥不同 columnName 得到无关子密钥（用于 AES-256 key）。v2 路径直接消费 raw 字节，
// 不需要 base64 编码（不再走 PG TEXT 协议）。
//
// keyVersion 必须先在 keyByVersion 注册过；未注册版本返 ErrCipherUnknownKeyVersion 让
// caller 透出运维配置漏（而非降级返错误密钥）。
func (s *CipherService) deriveKey(keyVersion int16, columnName string) ([]byte, error) {
	master, ok := s.keyByVersion[keyVersion]
	if !ok {
		return nil, fmt.Errorf("%w: v=%d (column %s)", ErrCipherUnknownKeyVersion, keyVersion, columnName)
	}
	info := []byte(hkdfInfoPrefix + columnName)
	h := hkdf.New(sha256.New, master, nil, info)
	derived := make([]byte, derivedKeyLen)
	// HKDF.Read 在请求 <= hash size 时不会返错误（依文档），忽略 err 不需 panic
	_, _ = h.Read(derived)
	return derived, nil
}

// Encrypt 用 v2 (AES-256-GCM) 加密，返回 [0x02 || nonce(12B) || ciphertext+tag(16B)]
// 与对应的 keyVersion（caller 写入 *_key_version 列）。
//
// 业务约定：
//   - plaintext == "" → 返 []byte{} 与 currentVer 不做加密（保留空记录语义；
//     即使密文为空，列上的 keyVersion 仍写当前版本，避免历史数据 v=0 混淆）
//   - 同 plaintext 多次 Encrypt 因 nonce 随机不会得到相同密文（防频率分析）
//   - 永远走 v2 cipher format；v1 (pgcrypto) Encrypt 已下线（C3 修复后新写入 0 走 PG bind path）
//   - keyVersion 永远是 currentVer；轮换主密钥时把 currentVer 改成 2，旧数据靠 row 列继续走 v=1
func (s *CipherService) Encrypt(_ context.Context, columnName, plaintext string) ([]byte, int16, error) {
	if plaintext == "" {
		return []byte{}, s.currentVer, nil
	}
	key, err := s.deriveKey(s.currentVer, columnName)
	if err != nil {
		return nil, 0, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, 0, fmt.Errorf("cipher: aes new %s: %w", columnName, err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, 0, fmt.Errorf("cipher: gcm new %s: %w", columnName, err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, 0, fmt.Errorf("cipher: rand nonce %s: %w", columnName, err)
	}
	sealed := gcm.Seal(nil, nonce, []byte(plaintext), nil)
	out := make([]byte, 0, 1+len(nonce)+len(sealed))
	out = append(out, cipherFormatV2)
	out = append(out, nonce...)
	out = append(out, sealed...)
	return out, s.currentVer, nil
}

// Decrypt 按密文 prefix 路由 + 按 keyVersion 选 master key：
//   - 第一字节 0x02 → v2 Go AES-GCM（标准路径，C3 修复后所有新数据）
//   - 否则 → v1 pgcrypto fallback（兼容历史落库；忽略 keyVersion 因为 v1 历史数据
//     落库时还没有版本列，统一按 currentVer 解 —— 历史 fixture 必须用同一 master key）
//
// keyVersion 来自 DB row 的 *_key_version 列；调用方读行时一并 SELECT 出来。
// caller 看到的对外语义：传 ciphertext + keyVersion 拿 plaintext，本服务自动选格式与 master key。
//
// keyVersion=0 时按 currentVer 兜底解密（向后兼容历史调 Decrypt 不传版本号的 caller，
// 但所有新代码都应显式传入；为兼容期保留默认行为，未来下线 v1 path 时一起严格化）。
func (s *CipherService) Decrypt(ctx context.Context, columnName string, ciphertext []byte, keyVersion int16) (string, error) {
	if len(ciphertext) == 0 {
		return "", nil
	}
	effectiveVer := keyVersion
	if effectiveVer == 0 {
		effectiveVer = s.currentVer
	}
	if ciphertext[0] == cipherFormatV2 {
		return s.decryptV2(effectiveVer, columnName, ciphertext)
	}
	return s.decryptV1Legacy(ctx, effectiveVer, columnName, ciphertext)
}

// decryptV2 解 v2 AES-256-GCM 密文。
//
// 密文格式：[0x02 || nonce(12B) || ciphertext+tag]
// 最小长度 = 1 (prefix) + 12 (nonce) + 16 (GCM tag) = 29 字节。
func (s *CipherService) decryptV2(keyVersion int16, columnName string, ciphertext []byte) (string, error) {
	const minLen = 1 + gcmNonceLen + 16 // prefix + nonce + GCM tag
	if len(ciphertext) < minLen {
		return "", fmt.Errorf("cipher: v2 ciphertext too short %s: %d < %d", columnName, len(ciphertext), minLen)
	}
	key, err := s.deriveKey(keyVersion, columnName)
	if err != nil {
		return "", err
	}
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
// DecryptBatch 一次解密多条同列密文（finding M7 follow-up）。
//
// 业务背景：
//   - feedback / payment List 路径每行单独调 Decrypt 是 N+1 模式
//   - v2 路径仅 in-memory AES，N+1 影响小但仍 N 次 derive 子密钥；批量复用能省 CPU
//   - v1 fallback 路径每行一次 PG round-trip → 50 行就 50 次 SELECT，明显瓶颈
//
// 业务流程：
//  1. 按 keyVersion 分桶（同 keyVersion 走同一 master key 子密钥）
//  2. v2 桶：in-memory loop 解密，N 条共用一次 deriveKey
//  3. v1 桶：拼一次 SELECT pgp_sym_decrypt(unnest($1::bytea[]), $2) 数组传参
//     PG 端按 unnest 顺序返回明文数组；service 按 index 写回
//
// 输入：ciphertexts 与 keyVersions 长度必须一致（N row 各自独立 keyVersion）；
// 都按调用方原始顺序索引；返回 plaintexts 长度 = N 与 ciphertexts 一一对应。
func (s *CipherService) DecryptBatch(ctx context.Context, columnName string, ciphertexts [][]byte, keyVersions []int16) ([]string, error) {
	if len(ciphertexts) != len(keyVersions) {
		return nil, fmt.Errorf("cipher: DecryptBatch length mismatch: %d ciphertexts vs %d keyVersions", len(ciphertexts), len(keyVersions))
	}
	out := make([]string, len(ciphertexts))

	// 按版本分桶 + 路由（v2 in-memory / v1 PG batch）
	// idx 数组保留 plaintext 写回 out 的原始位置
	type bucket struct {
		indices []int
		cts     [][]byte
	}
	v2Buckets := map[int16]*bucket{} // 第一字节 0x02
	v1Buckets := map[int16]*bucket{} // 其它 prefix
	for i, ct := range ciphertexts {
		if len(ct) == 0 {
			out[i] = "" // 空密文短路
			continue
		}
		ver := keyVersions[i]
		if ver == 0 {
			ver = s.currentVer
		}
		if ct[0] == cipherFormatV2 {
			b := v2Buckets[ver]
			if b == nil {
				b = &bucket{}
				v2Buckets[ver] = b
			}
			b.indices = append(b.indices, i)
			b.cts = append(b.cts, ct)
		} else {
			b := v1Buckets[ver]
			if b == nil {
				b = &bucket{}
				v1Buckets[ver] = b
			}
			b.indices = append(b.indices, i)
			b.cts = append(b.cts, ct)
		}
	}

	// v2 桶：in-memory，每桶共用 deriveKey
	for ver, b := range v2Buckets {
		key, err := s.deriveKey(ver, columnName)
		if err != nil {
			return nil, err
		}
		block, err := aes.NewCipher(key)
		if err != nil {
			return nil, fmt.Errorf("cipher: aes new %s: %w", columnName, err)
		}
		gcm, err := cipher.NewGCM(block)
		if err != nil {
			return nil, fmt.Errorf("cipher: gcm new %s: %w", columnName, err)
		}
		const minLen = 1 + gcmNonceLen + 16
		for j, ct := range b.cts {
			if len(ct) < minLen {
				return nil, fmt.Errorf("cipher: v2 ciphertext too short %s: %d < %d", columnName, len(ct), minLen)
			}
			pt, err := gcm.Open(nil, ct[1:1+gcmNonceLen], ct[1+gcmNonceLen:], nil)
			if err != nil {
				return nil, fmt.Errorf("cipher: gcm open %s: %w", columnName, err)
			}
			out[b.indices[j]] = string(pt)
		}
	}

	// v1 桶：一次 SQL 用 unnest 数组传参 + pgp_sym_decrypt 同密钥批量解密
	for ver, b := range v1Buckets {
		rawKey, err := s.deriveKey(ver, columnName)
		if err != nil {
			return nil, err
		}
		derived := base64.StdEncoding.EncodeToString(rawKey)
		// pgp_sym_decrypt(unnest, key) 返回与 unnest 顺序一致的 SETOF text；
		// 用 WITH ORDINALITY 保索引明确（避免 PG 实现细节顺序假设）
		rows, err := s.db.Query(ctx, `
			SELECT pgp_sym_decrypt(c, $2) FROM unnest($1::bytea[]) WITH ORDINALITY t(c, ord) ORDER BY ord
		`, b.cts, derived)
		if err != nil {
			return nil, fmt.Errorf("cipher: pgp_sym_decrypt v1 batch %s: %w", columnName, err)
		}
		j := 0
		for rows.Next() {
			var pt string
			if err := rows.Scan(&pt); err != nil {
				rows.Close()
				return nil, fmt.Errorf("cipher: scan v1 batch %s: %w", columnName, err)
			}
			if j >= len(b.indices) {
				rows.Close()
				return nil, fmt.Errorf("cipher: v1 batch returned more rows than expected for %s", columnName)
			}
			out[b.indices[j]] = pt
			j++
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, fmt.Errorf("cipher: iterate v1 batch %s: %w", columnName, err)
		}
		rows.Close()
		if j != len(b.indices) {
			return nil, fmt.Errorf("cipher: v1 batch returned %d rows, expected %d for %s", j, len(b.indices), columnName)
		}
	}

	return out, nil
}

func (s *CipherService) decryptV1Legacy(ctx context.Context, keyVersion int16, columnName string, ciphertext []byte) (string, error) {
	rawKey, err := s.deriveKey(keyVersion, columnName)
	if err != nil {
		return "", err
	}
	derived := base64.StdEncoding.EncodeToString(rawKey)
	var plaintext string
	if err := s.db.QueryRow(ctx,
		`SELECT pgp_sym_decrypt($1, $2)`,
		ciphertext, derived,
	).Scan(&plaintext); err != nil {
		return "", fmt.Errorf("cipher: pgp_sym_decrypt v1 fallback %s: %w", columnName, err)
	}
	return plaintext, nil
}
