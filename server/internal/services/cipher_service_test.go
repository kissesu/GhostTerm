// @file cipher_service_test.go
// @description CipherService 4 个核心场景测试 —— round-trip / 列隔离 / 短主密钥拒绝 / 空值兜底
//
//	业务证明：
//	  1. RoundTrip：加密后解密回明文（含中文 + UTF-8 + 标点）
//	  2. DifferentColumnDifferentKey：同明文不同列 → 不同密文（HKDF info 绑定生效）
//	  3. RejectsShortMasterKey：主密钥 < 32 字节构造期失败（fail-fast）
//	  4. EmptyPlaintextReturnsEmpty：空字符串短路不调 PG，密文也是空 []byte
//
//	测试上下文：dockertest pg 16-alpine（与其它 service test 同模式），主密钥用
//	固定 32 字节常量便于多 case 复用。
//
// @author Atlas.oi
// @date 2026-05-08

package services_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ghostterm/progress-server/internal/services"
	"github.com/ghostterm/progress-server/internal/testutil"
)

// testCipherKey 32 字节 ASCII 主密钥；不暴露给生产，仅本测试文件用。
const testCipherKey = "test-master-key-32-bytes-aaaaa!!"

func TestCipherService_RoundTrip(t *testing.T) {
	pool, cleanup := testutil.StartPostgres(t)
	defer cleanup()

	cs, err := services.NewCipherService(pool, []byte(testCipherKey))
	require.NoError(t, err)

	plaintext := "敏感内容含中文 + 表情符号位置 abc 123"
	ctx := context.Background()
	encrypted, err := cs.Encrypt(ctx, "feedbacks_content", plaintext)
	require.NoError(t, err)
	require.NotEmpty(t, encrypted, "密文不应为空")
	require.NotEqual(t, plaintext, string(encrypted), "密文不应等于明文")

	decrypted, err := cs.Decrypt(ctx, "feedbacks_content", encrypted)
	require.NoError(t, err)
	require.Equal(t, plaintext, decrypted, "解密后应得原始明文")
}

func TestCipherService_DifferentColumnDifferentKey(t *testing.T) {
	pool, cleanup := testutil.StartPostgres(t)
	defer cleanup()

	cs, err := services.NewCipherService(pool, []byte(testCipherKey))
	require.NoError(t, err)

	ctx := context.Background()
	enc1, err := cs.Encrypt(ctx, "feedbacks_content", "same plaintext")
	require.NoError(t, err)
	enc2, err := cs.Encrypt(ctx, "payments_remark", "same plaintext")
	require.NoError(t, err)

	require.NotEqual(t, enc1, enc2,
		"不同列 HKDF info 应派生不同子密钥，得到不同密文（防 feedbacks 泄露连带 payments）")

	// 进一步确认：用 column1 的子密钥解 column2 的密文必失败
	_, err = cs.Decrypt(ctx, "feedbacks_content", enc2)
	assert.Error(t, err, "用 feedbacks_content 子密钥解 payments_remark 密文必失败")
}

func TestCipherService_RejectsShortMasterKey(t *testing.T) {
	pool, cleanup := testutil.StartPostgres(t)
	defer cleanup()

	_, err := services.NewCipherService(pool, []byte("short"))
	require.Error(t, err)
	assert.Contains(t, err.Error(), ">=32", "错误消息应明示最小 32 字节")
}

func TestCipherService_EmptyPlaintextReturnsEmpty(t *testing.T) {
	pool, cleanup := testutil.StartPostgres(t)
	defer cleanup()

	cs, err := services.NewCipherService(pool, []byte(testCipherKey))
	require.NoError(t, err)

	ctx := context.Background()
	encrypted, err := cs.Encrypt(ctx, "feedbacks_content", "")
	require.NoError(t, err)
	assert.Empty(t, encrypted, "空明文应短路返回空密文，不调 PG")

	decrypted, err := cs.Decrypt(ctx, "feedbacks_content", []byte{})
	require.NoError(t, err)
	assert.Equal(t, "", decrypted, "空密文应返回空字符串")
}
