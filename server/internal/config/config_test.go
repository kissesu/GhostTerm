/*
@file config_test.go
@description config.Load 单元测试 —— 覆盖必填缺失报错、可选项默认值、duration/int 解析失败显式报错。
             不依赖外部资源（DB/文件系统），使用 t.Setenv 隔离环境。
@author Atlas.oi
@date 2026-04-29
*/

package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// setRequiredEnv 给四个必填项填上有效值，便于 case 单独覆盖某一项缺失。
//
// finding #4：GT_DATA_KEY 是新增必填项，与 JWT secret 同样 fail-fast at startup。
func setRequiredEnv(t *testing.T) {
	t.Helper()
	t.Setenv("DATABASE_URL", "postgres://user:pwd@localhost:5432/test?sslmode=disable")
	t.Setenv("JWT_ACCESS_SECRET", "access-secret-min-32-chars-xxxxxxxx")
	t.Setenv("JWT_REFRESH_SECRET", "refresh-secret-min-32-chars-xxxxxxxx")
	t.Setenv("GT_DATA_KEY", "test-data-key-32-bytes-aaaaaaaaa")
}

// clearOptionalEnv 把可选项全部清空，验证默认回落
func clearOptionalEnv(t *testing.T) {
	t.Helper()
	for _, k := range []string{
		"HTTP_ADDR", "JWT_ACCESS_TTL", "JWT_REFRESH_TTL",
		"BCRYPT_COST", "FILE_STORAGE_PATH", "FILE_MAX_SIZE_MB",
	} {
		t.Setenv(k, "")
	}
}

func TestLoad_Defaults(t *testing.T) {
	setRequiredEnv(t)
	clearOptionalEnv(t)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.HTTPAddr != ":8080" {
		t.Errorf("HTTPAddr default mismatch: %q", cfg.HTTPAddr)
	}
	if cfg.JWTAccessTTL != 15*time.Minute {
		t.Errorf("JWTAccessTTL default mismatch: %v", cfg.JWTAccessTTL)
	}
	if cfg.JWTRefreshTTL != 168*time.Hour {
		t.Errorf("JWTRefreshTTL default mismatch: %v", cfg.JWTRefreshTTL)
	}
	if cfg.BcryptCost != 12 {
		t.Errorf("BcryptCost default mismatch: %d", cfg.BcryptCost)
	}
	if cfg.FileStoragePath != "./data/files" {
		t.Errorf("FileStoragePath default mismatch: %q", cfg.FileStoragePath)
	}
	if cfg.FileMaxSizeMB != 100 {
		t.Errorf("FileMaxSizeMB default mismatch: %d", cfg.FileMaxSizeMB)
	}
}

func TestLoad_Overrides(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("HTTP_ADDR", ":9090")
	t.Setenv("JWT_ACCESS_TTL", "30m")
	t.Setenv("JWT_REFRESH_TTL", "720h")
	t.Setenv("BCRYPT_COST", "14")
	t.Setenv("FILE_STORAGE_PATH", "/var/lib/progress/files")
	t.Setenv("FILE_MAX_SIZE_MB", "256")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.HTTPAddr != ":9090" {
		t.Errorf("HTTPAddr override mismatch: %q", cfg.HTTPAddr)
	}
	if cfg.JWTAccessTTL != 30*time.Minute {
		t.Errorf("JWTAccessTTL override mismatch: %v", cfg.JWTAccessTTL)
	}
	if cfg.JWTRefreshTTL != 720*time.Hour {
		t.Errorf("JWTRefreshTTL override mismatch: %v", cfg.JWTRefreshTTL)
	}
	if cfg.BcryptCost != 14 {
		t.Errorf("BcryptCost override mismatch: %d", cfg.BcryptCost)
	}
	if cfg.FileStoragePath != "/var/lib/progress/files" {
		t.Errorf("FileStoragePath override mismatch: %q", cfg.FileStoragePath)
	}
	if cfg.FileMaxSizeMB != 256 {
		t.Errorf("FileMaxSizeMB override mismatch: %d", cfg.FileMaxSizeMB)
	}
}

func TestLoad_MissingDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("JWT_ACCESS_SECRET", "access-secret")
	t.Setenv("JWT_REFRESH_SECRET", "refresh-secret")
	t.Setenv("GT_DATA_KEY", "test-data-key-32-bytes-aaaaaaaaa")

	_, err := Load()
	if err == nil {
		t.Fatal("expected error when DATABASE_URL missing")
	}
	if !strings.Contains(err.Error(), "DATABASE_URL") {
		t.Errorf("error should mention DATABASE_URL, got: %v", err)
	}
}

func TestLoad_MissingAccessSecret(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://...")
	t.Setenv("JWT_ACCESS_SECRET", "")
	t.Setenv("JWT_REFRESH_SECRET", "refresh")
	t.Setenv("GT_DATA_KEY", "test-data-key-32-bytes-aaaaaaaaa")

	_, err := Load()
	if err == nil {
		t.Fatal("expected error when JWT_ACCESS_SECRET missing")
	}
	if !strings.Contains(err.Error(), "JWT_ACCESS_SECRET") {
		t.Errorf("error should mention JWT_ACCESS_SECRET, got: %v", err)
	}
}

func TestLoad_MissingRefreshSecret(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://...")
	// access 必须 ≥32 字节才能走到 refresh 检查（Load 顺序：先 access 长度后 refresh 空值）
	t.Setenv("JWT_ACCESS_SECRET", "access-secret-min-32-chars-xxxxxxxx")
	t.Setenv("JWT_REFRESH_SECRET", "")
	t.Setenv("GT_DATA_KEY", "test-data-key-32-bytes-aaaaaaaaa")

	_, err := Load()
	if err == nil {
		t.Fatal("expected error when JWT_REFRESH_SECRET missing")
	}
	if !strings.Contains(err.Error(), "JWT_REFRESH_SECRET") {
		t.Errorf("error should mention JWT_REFRESH_SECRET, got: %v", err)
	}
}

func TestLoad_InvalidDuration(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("JWT_ACCESS_TTL", "not-a-duration")

	_, err := Load()
	if err == nil {
		t.Fatal("expected error when JWT_ACCESS_TTL invalid")
	}
	if !strings.Contains(err.Error(), "JWT_ACCESS_TTL") {
		t.Errorf("error should mention JWT_ACCESS_TTL, got: %v", err)
	}
}

func TestLoad_InvalidInt(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("BCRYPT_COST", "abc")

	_, err := Load()
	if err == nil {
		t.Fatal("expected error when BCRYPT_COST invalid")
	}
	if !strings.Contains(err.Error(), "BCRYPT_COST") {
		t.Errorf("error should mention BCRYPT_COST, got: %v", err)
	}
}

func TestLoad_SecretsAsBytes(t *testing.T) {
	setRequiredEnv(t)
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if string(cfg.JWTAccessSecret) != "access-secret-min-32-chars-xxxxxxxx" {
		t.Errorf("JWTAccessSecret content mismatch")
	}
	if string(cfg.JWTRefreshSecret) != "refresh-secret-min-32-chars-xxxxxxxx" {
		t.Errorf("JWTRefreshSecret content mismatch")
	}
}

// TestLoad_RejectsShortJWTAccessSecret 验证 access secret < 32 字节 fail-fast。
//
// 业务背景：HS256 密钥长度直接决定离线暴破成本，1 字节密钥分钟级即可破解。
// 32 字节是 HS256 推荐下限（与 SHA-256 输出宽度一致，攻击者无法借更短密钥取捷径）。
func TestLoad_RejectsShortJWTAccessSecret(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x:y@localhost:5432/z?sslmode=disable")
	t.Setenv("JWT_ACCESS_SECRET", "short") // 5 字节，远小于 32
	t.Setenv("JWT_REFRESH_SECRET", "another-secret-32-bytes-long-aaa")
	t.Setenv("GT_DATA_KEY", "test-data-key-32-bytes-aaaaaaaaa")

	_, err := Load()
	if err == nil {
		t.Fatal("expected error when JWT_ACCESS_SECRET shorter than 32 bytes")
	}
	if !strings.Contains(err.Error(), "JWT_ACCESS_SECRET") {
		t.Errorf("error should mention JWT_ACCESS_SECRET, got: %v", err)
	}
}

// TestLoad_RejectsShortJWTRefreshSecret 验证 refresh secret < 32 字节 fail-fast。
func TestLoad_RejectsShortJWTRefreshSecret(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x:y@localhost:5432/z?sslmode=disable")
	t.Setenv("JWT_ACCESS_SECRET", "this-secret-is-32-bytes-long!aaa")
	t.Setenv("JWT_REFRESH_SECRET", "tiny") // 4 字节
	t.Setenv("GT_DATA_KEY", "test-data-key-32-bytes-aaaaaaaaa")

	_, err := Load()
	if err == nil {
		t.Fatal("expected error when JWT_REFRESH_SECRET shorter than 32 bytes")
	}
	if !strings.Contains(err.Error(), "JWT_REFRESH_SECRET") {
		t.Errorf("error should mention JWT_REFRESH_SECRET, got: %v", err)
	}
}

// TestLoad_RejectsEqualAccessAndRefreshSecrets 验证 access==refresh 时拒启动。
//
// 业务背景：双密钥拆分的核心价值是 access 短期 / refresh 长期独立轮换；
// 同值 = 设计意图作废 + 单点泄露同时炸两类 token。
func TestLoad_RejectsEqualAccessAndRefreshSecrets(t *testing.T) {
	same := "this-secret-is-32-bytes-long!!!!"
	t.Setenv("DATABASE_URL", "postgres://x:y@localhost:5432/z?sslmode=disable")
	t.Setenv("JWT_ACCESS_SECRET", same)
	t.Setenv("JWT_REFRESH_SECRET", same)
	t.Setenv("GT_DATA_KEY", "test-data-key-32-bytes-aaaaaaaaa")

	_, err := Load()
	if err == nil {
		t.Fatal("expected error when access and refresh secrets are identical")
	}
	if !strings.Contains(err.Error(), "must differ") {
		t.Errorf("error should mention 'must differ', got: %v", err)
	}
}

// TestLoad_AcceptsValidSecrets 正例：32 字节且互异通过校验。
func TestLoad_AcceptsValidSecrets(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x:y@localhost:5432/z?sslmode=disable")
	t.Setenv("JWT_ACCESS_SECRET", "this-is-a-valid-access-secret-32!")
	t.Setenv("JWT_REFRESH_SECRET", "this-is-a-valid-refresh-secret-32")
	t.Setenv("GT_DATA_KEY", "test-data-key-32-bytes-aaaaaaaaa")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned unexpected error: %v", err)
	}
	if cfg == nil {
		t.Fatal("Load returned nil cfg without error")
	}
	if string(cfg.JWTAccessSecret) != "this-is-a-valid-access-secret-32!" {
		t.Errorf("JWTAccessSecret content mismatch")
	}
}

// TestLoad_RejectsMissingDataKey 验证 GT_DATA_KEY 缺失 fail-fast（finding #4）。
//
// 业务背景：feedbacks.content / payments.remark 列级加密必须有主密钥；
// 缺失启动 = 加密 service 构造失败 = 业务路径全断，必须 startup 期暴露。
func TestLoad_RejectsMissingDataKey(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x:y@localhost:5432/z?sslmode=disable")
	t.Setenv("JWT_ACCESS_SECRET", "this-is-a-valid-access-secret-32!")
	t.Setenv("JWT_REFRESH_SECRET", "this-is-a-valid-refresh-secret-32")
	t.Setenv("GT_DATA_KEY", "")

	_, err := Load()
	if err == nil {
		t.Fatal("expected error when GT_DATA_KEY missing")
	}
	if !strings.Contains(err.Error(), "GT_DATA_KEY") {
		t.Errorf("error should mention GT_DATA_KEY, got: %v", err)
	}
}

// TestLoad_RejectsShortDataKey 验证 GT_DATA_KEY < 32 字节 fail-fast（finding #4）。
func TestLoad_RejectsShortDataKey(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x:y@localhost:5432/z?sslmode=disable")
	t.Setenv("JWT_ACCESS_SECRET", "this-is-a-valid-access-secret-32!")
	t.Setenv("JWT_REFRESH_SECRET", "this-is-a-valid-refresh-secret-32")
	t.Setenv("GT_DATA_KEY", "tiny-key") // 8 字节远小于 32

	_, err := Load()
	if err == nil {
		t.Fatal("expected error when GT_DATA_KEY shorter than 32 bytes")
	}
	if !strings.Contains(err.Error(), "GT_DATA_KEY") {
		t.Errorf("error should mention GT_DATA_KEY, got: %v", err)
	}
}

// ============================================
// finding #5：systemd-creds 优先于 env 读取 secrets
// ============================================
//
// 业务背景：生产部署用 systemd 250+ 的 LoadCredentialEncrypted，
// host TPM 派生密钥解密到 $CREDENTIALS_DIRECTORY/<name>（tmpfs，仅当前 boot 周期可用）。
// 磁盘快照拿到 /etc/ghostterm/credentials/*.cred 是密文，无法解密。
// dev / docker-compose / CI 没有 systemd-creds，必须 fallback env。

// TestReadSecretFromCredentials_PrefersSystemdCreds 验证有 $CREDENTIALS_DIRECTORY/<name> 时
// 优先读文件，env 被忽略。
func TestReadSecretFromCredentials_PrefersSystemdCreds(t *testing.T) {
	tmpDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmpDir, "jwt_access"), []byte("32-byte-credentials-secret-aaaa\n"), 0600); err != nil {
		t.Fatalf("write tmp cred: %v", err)
	}

	t.Setenv("CREDENTIALS_DIRECTORY", tmpDir)
	t.Setenv("JWT_ACCESS_SECRET", "fallback-env-value-32-bytes-aaa")

	got := ReadSecretFromCredentials("jwt_access", "JWT_ACCESS_SECRET")
	if got != "32-byte-credentials-secret-aaaa" {
		t.Errorf("应优先 systemd-creds 而非 env，got %q", got)
	}
}

// TestReadSecretFromCredentials_FallsBackToEnv 验证 $CREDENTIALS_DIRECTORY 未设置时回落 env。
func TestReadSecretFromCredentials_FallsBackToEnv(t *testing.T) {
	t.Setenv("CREDENTIALS_DIRECTORY", "") // 空 = 视为未设置
	t.Setenv("JWT_ACCESS_SECRET", "env-fallback-32-bytes-aaaaaaaa")

	got := ReadSecretFromCredentials("jwt_access", "JWT_ACCESS_SECRET")
	if got != "env-fallback-32-bytes-aaaaaaaa" {
		t.Errorf("CREDENTIALS_DIRECTORY 空应回落 env，got %q", got)
	}
}

// TestReadSecretFromCredentials_FileNotExistFallsBack 验证目录设置但文件不存在时回落 env。
//
// 业务场景：部分 secret 走 systemd-creds，部分仍走 env 共存。
func TestReadSecretFromCredentials_FileNotExistFallsBack(t *testing.T) {
	tmpDir := t.TempDir()
	// 目录设了但文件没创建
	t.Setenv("CREDENTIALS_DIRECTORY", tmpDir)
	t.Setenv("JWT_ACCESS_SECRET", "env-fallback-32-bytes-aaaaaaaa")

	got := ReadSecretFromCredentials("jwt_access", "JWT_ACCESS_SECRET")
	if got != "env-fallback-32-bytes-aaaaaaaa" {
		t.Errorf("文件不存在应回落 env，got %q", got)
	}
}

// TestReadSecretFromCredentials_TrimsTrailingNewline 验证 systemd-creds 写出的尾部 \n 被 trim。
//
// 业务背景：systemd-creds encrypt 通常以文本写入凭据，末尾可能多一个或多个 \n，
// 直接拿来当 JWT 密钥/DB URL 会导致字节数对不上、连接串解析错误。
func TestReadSecretFromCredentials_TrimsTrailingNewline(t *testing.T) {
	tmpDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmpDir, "data_key"), []byte("data-key-32-bytes-aaaaaaaaaaaa\n\n"), 0600); err != nil {
		t.Fatalf("write tmp cred: %v", err)
	}
	t.Setenv("CREDENTIALS_DIRECTORY", tmpDir)

	got := ReadSecretFromCredentials("data_key", "GT_DATA_KEY")
	if got != "data-key-32-bytes-aaaaaaaaaaaa" {
		t.Errorf("尾部换行应被 trim，got %q", got)
	}
}
