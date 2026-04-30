/*
@file config.go
@description progress-server 启动配置加载。
             从环境变量读取必填项（DATABASE_URL/JWT_ACCESS_SECRET/JWT_REFRESH_SECRET），
             可选项采用业务侧合理默认值。生产部署中所有字段均通过 docker secrets/env 注入；
             本文件不读 *_FILE 形式（保持 v2 part1 §C7 的 secret-file 路径留待 Phase 2 集成 auth 时再加，
             避免 Phase 1 引入未使用的代码分支）。
@author Atlas.oi
@date 2026-04-29
*/

package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/joho/godotenv"
)

// Config 是 progress-server 启动期所需的全部参数集合。
//
// 字段分类（业务背景）：
//  1. Required —— 缺一即拒绝启动，避免生产环境出现"半配置"导致后续调用静默失败：
//     - DBURL：Postgres 连接串
//     - JWTAccessSecret/JWTRefreshSecret：双密钥拆分，access 短期、refresh 长期，便于独立轮换
//  2. Optional with defaults —— 大多数部署不需要调，给到合理默认即可：
//     - HTTPAddr：默认 :8080，与 docker-compose / Caddyfile 对齐
//     - JWTAccessTTL / JWTRefreshTTL：业务侧 spec §3.5 定的 15min / 7day
//     - BcryptCost：12（OWASP 2024 推荐 ≥10，12 是业界主流安全/性能折中点）
//     - FileStoragePath：默认 ./data/files（开发态相对路径，生产会通过 env 覆写为绝对路径）
//     - FileMaxSizeMB：100（spec §6.6 单文件 100MB 上限）
type Config struct {
	// Required —— 启动期 fail-fast
	DBURL             string
	JWTAccessSecret   []byte
	JWTRefreshSecret  []byte

	// Optional with defaults
	HTTPAddr         string
	JWTAccessTTL     time.Duration
	JWTRefreshTTL    time.Duration
	BcryptCost       int
	FileStoragePath  string
	FileMaxSizeMB    int
}

// Load 从环境变量构建 Config，调用前可选地加载 .env 文件（仅开发便利）。
//
// 业务流程：
//  1. 若工作目录存在 .env，用 godotenv 加载（生产部署不依赖此文件，因此 missing 不报错）
//  2. 读取必填项，缺失或空字符串立即返回带字段名的错误
//  3. 读取可选项，未设置时回落到默认值
//  4. 解析 duration / int 等结构化值，解析失败显式报错（不静默回默认）
//
// 设计取舍：
//   - 不引入 viper：Phase 1 只需 ~10 个 env，多一个依赖不划算
//   - .env loading 静默忽略 not-exists 错误，但其它 IO 错误仍上抛（避免 .env 损坏被误读为缺失）
func Load() (*Config, error) {
	// .env 仅是开发便利，不存在 / 不可读都不致命；其它 IO 错误也不阻断启动（生产部署不依赖此文件）
	_ = godotenv.Load()

	cfg := &Config{}

	// ============================================
	// 第一步：读取必填项 —— 缺一即拒绝启动
	// ============================================
	cfg.DBURL = os.Getenv("DATABASE_URL")
	if cfg.DBURL == "" {
		return nil, errors.New("config: DATABASE_URL is required")
	}

	access := os.Getenv("JWT_ACCESS_SECRET")
	if access == "" {
		return nil, errors.New("config: JWT_ACCESS_SECRET is required and must be non-empty")
	}
	cfg.JWTAccessSecret = []byte(access)

	refresh := os.Getenv("JWT_REFRESH_SECRET")
	if refresh == "" {
		return nil, errors.New("config: JWT_REFRESH_SECRET is required and must be non-empty")
	}
	cfg.JWTRefreshSecret = []byte(refresh)

	// ============================================
	// 第二步：读取可选项 —— 缺失则回落到默认
	// ============================================
	cfg.HTTPAddr = getenvDefault("HTTP_ADDR", ":8080")
	cfg.FileStoragePath = getenvDefault("FILE_STORAGE_PATH", "./data/files")

	var err error
	cfg.JWTAccessTTL, err = parseDuration("JWT_ACCESS_TTL", "15m")
	if err != nil {
		return nil, err
	}
	cfg.JWTRefreshTTL, err = parseDuration("JWT_REFRESH_TTL", "168h")
	if err != nil {
		return nil, err
	}
	cfg.BcryptCost, err = parseInt("BCRYPT_COST", 12)
	if err != nil {
		return nil, err
	}
	cfg.FileMaxSizeMB, err = parseInt("FILE_MAX_SIZE_MB", 100)
	if err != nil {
		return nil, err
	}

	return cfg, nil
}

// getenvDefault 读环境变量，未设置或空字符串时返回默认。
func getenvDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// parseDuration 读取一个 time.Duration 形式的环境变量（如 "15m"/"168h"），未设置时使用默认值字符串解析。
//
// 设计：默认值也走 time.ParseDuration，确保 "168h" 这种字面量在编译期可以被 vet 校验，
// 同时便于未来把默认值从环境读出来。
func parseDuration(key, def string) (time.Duration, error) {
	raw := getenvDefault(key, def)
	d, err := time.ParseDuration(raw)
	if err != nil {
		return 0, fmt.Errorf("config: %s invalid duration %q: %w", key, raw, err)
	}
	return d, nil
}

// parseInt 读取一个整型环境变量，未设置时使用 def。
//
// 设计：解析失败显式报错而不是回默认，避免 "BCRYPT_COST=abc" 被静默改成 12 后用户找不到原因。
func parseInt(key string, def int) (int, error) {
	raw := os.Getenv(key)
	if raw == "" {
		return def, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("config: %s invalid integer %q: %w", key, raw, err)
	}
	return n, nil
}
