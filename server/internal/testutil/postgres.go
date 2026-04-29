/*
@file postgres.go
@description 集成测试用 Postgres 容器 helper —— 用 dockertest 启 postgres:16-alpine，
             跑 0001+0002 迁移后返回连接池 + cleanup func。每个测试函数自起一个容器，
             避免测试间的 schema/数据干扰。OrbStack / Docker Desktop 任一即可。
@author Atlas.oi
@date 2026-04-29
*/

package testutil

import (
	"context"
	"fmt"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/ory/dockertest/v3"
	"github.com/ory/dockertest/v3/docker"

	progressdb "github.com/ghostterm/progress-server/internal/db"
)

// StartPostgres 启动 postgres:16-alpine 容器、跑迁移、返回连接池 + cleanup。
//
// 业务流程：
//  1. 连接 docker daemon（OrbStack / Docker Desktop / Linux daemon 任一）
//  2. RunWithOptions 拉起 postgres:16-alpine（明确 platform=linux/amd64 兜底，OrbStack 在 ARM mac 上能透明翻译）
//  3. 用 NewPool（含 NUMERIC text codec）连接，最长 retry 30s 等到 ready
//  4. 用 golang-migrate 跑 migrations/0001_*+0002_*
//  5. 返回 pool + cleanup（cleanup 关池 + Purge 容器）
//
// 设计取舍：
//   - 用 NewPool 而不是裸 pgxpool.New：保证测试用的池行为与生产一致（NUMERIC text codec 已注册）
//   - migrationsPath 通过 runtime.Caller 推算，让 testutil 在任意 package 被 import 都能找到
//     server/migrations/，避免 cwd 变化导致迁移失败
//   - container restart_policy=no（测试结束 cleanup 一并删除）
func StartPostgres(t *testing.T) (*pgxpool.Pool, func()) {
	t.Helper()

	dPool, err := dockertest.NewPool("")
	if err != nil {
		t.Fatalf("dockertest pool: %v", err)
	}
	if err := dPool.Client.Ping(); err != nil {
		t.Fatalf("ping docker daemon: %v", err)
	}

	resource, err := dPool.RunWithOptions(&dockertest.RunOptions{
		Repository: "postgres",
		Tag:        "16-alpine",
		Env: []string{
			"POSTGRES_USER=postgres",
			"POSTGRES_PASSWORD=test",
			"POSTGRES_DB=progress_test",
			// 加快首次启动：禁用 fsync 在临时容器内是安全的（容器会被销毁）
			"POSTGRES_INITDB_ARGS=--no-locale --encoding=UTF8",
		},
	}, func(hc *docker.HostConfig) {
		hc.AutoRemove = true
		hc.RestartPolicy = docker.RestartPolicy{Name: "no"}
	})
	if err != nil {
		t.Fatalf("start postgres: %v", err)
	}

	// 容器在 cleanup 前不应被自动 Expire（默认 dockertest 给 60s）；
	// 集成测试可能涉及多次 RunWithOptions，120s 给迁移 + 测试足够余量
	if err := resource.Expire(120); err != nil {
		t.Fatalf("set container expire: %v", err)
	}

	port := resource.GetPort("5432/tcp")
	dsn := fmt.Sprintf("postgres://postgres:test@127.0.0.1:%s/progress_test?sslmode=disable", port)

	// 连接 retry：postgres alpine 冷启动 1-3 秒，dockertest pool.Retry 默认 60s 够用
	dPool.MaxWait = 30 * time.Second

	var sqlPool *pgxpool.Pool
	if err := dPool.Retry(func() error {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		p, err := progressdb.NewPool(ctx, dsn)
		if err != nil {
			return err
		}
		if err := p.Ping(ctx); err != nil {
			p.Close()
			return err
		}
		sqlPool = p
		return nil
	}); err != nil {
		_ = dPool.Purge(resource)
		t.Fatalf("connect postgres: %v", err)
	}

	// 跑迁移
	if err := applyMigrations(dsn); err != nil {
		sqlPool.Close()
		_ = dPool.Purge(resource)
		t.Fatalf("apply migrations: %v", err)
	}

	cleanup := func() {
		sqlPool.Close()
		if err := dPool.Purge(resource); err != nil {
			// 不 t.Fatal —— Purge 失败不应让测试结果翻转，但要打印让人工清理
			t.Logf("purge container: %v", err)
		}
	}
	return sqlPool, cleanup
}

// applyMigrations 用 golang-migrate 跑 server/migrations/。
//
// 业务背景：
//   - 生产部署 runbook 用 `migrate` CLI（避免 server 二进制带 IO 副作用），
//     测试侧直接 import golang-migrate 库使用，效果一致
//   - migrationsDir 通过 runtime.Caller 反推，独立于 test 进程的 cwd
func applyMigrations(dsn string) error {
	dir, err := migrationsDir()
	if err != nil {
		return err
	}
	m, err := migrate.New("file://"+dir, dsn)
	if err != nil {
		return fmt.Errorf("migrate new: %w", err)
	}
	defer func() {
		// migrate.Close 返回 (sourceErr, dbErr)；测试场景下 best-effort
		_, _ = m.Close()
	}()
	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		return fmt.Errorf("migrate up: %w", err)
	}
	return nil
}

// migrationsDir 返回 server/migrations 的绝对路径。
//
// 业务背景：本文件位于 server/internal/testutil/postgres.go，
// migrations 在 server/migrations，相对偏移 ../../migrations。
// 用 runtime.Caller(0) 拿当前文件路径，独立于 test 进程的 cwd。
func migrationsDir() (string, error) {
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		return "", fmt.Errorf("runtime.Caller failed")
	}
	abs, err := filepath.Abs(filepath.Join(filepath.Dir(thisFile), "..", "..", "migrations"))
	if err != nil {
		return "", fmt.Errorf("abs migrations dir: %w", err)
	}
	return abs, nil
}
