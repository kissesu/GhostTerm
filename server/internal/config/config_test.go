/*
@file config_test.go
@description config.Load 单元测试 —— 覆盖必填缺失报错、可选项默认值、duration/int 解析失败显式报错。
             不依赖外部资源（DB/文件系统），使用 t.Setenv 隔离环境。
@author Atlas.oi
@date 2026-04-29
*/

package config

import (
	"strings"
	"testing"
	"time"
)

// setRequiredEnv 给三个必填项填上有效值，便于 case 单独覆盖某一项缺失。
func setRequiredEnv(t *testing.T) {
	t.Helper()
	t.Setenv("DATABASE_URL", "postgres://user:pwd@localhost:5432/test?sslmode=disable")
	t.Setenv("JWT_ACCESS_SECRET", "access-secret-min-32-chars-xxxxxxxx")
	t.Setenv("JWT_REFRESH_SECRET", "refresh-secret-min-32-chars-xxxxxxxx")
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
	t.Setenv("JWT_ACCESS_SECRET", "access")
	t.Setenv("JWT_REFRESH_SECRET", "")

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
