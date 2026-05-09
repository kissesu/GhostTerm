/*
@file postgres.go
@description 集成测试用 Postgres 容器 helper —— 用 dockertest 启 postgres:16-alpine，
             跑 0001+0002 迁移后返回连接池 + cleanup func。

             支持两种模式：
               1) per-test 容器（默认）—— 每个测试自起独立容器，最大隔离；
                  handlers/router/integration 包用此模式。
               2) 共享容器（sharedPool 非 nil）—— TestMain 起一次容器，每测试 truncate 复用；
                  services 包用此模式，CI 时间从 120s+ 降到 30-60s。
                  通过 SetSharedPool 注入；StartPostgres 内部按是否设置走分流路径。

             OrbStack / Docker Desktop 任一即可。
@author Atlas.oi
@date 2026-04-29
*/

package testutil

import (
	"context"
	"fmt"
	"path/filepath"
	"runtime"
	"sync"
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

// sharedPool 是包级 TestMain 注入的共享 postgres 连接池。
//
// 业务背景：services 包 130+ 测试如果 per-test 起容器，CI 120s 预算会爆表；
// services/main_test.go 的 TestMain 起一个容器后调 SetSharedPool，使 StartPostgres
// 进入 fast path（truncate 复用而非起新容器）。其他包不调 SetSharedPool 维持原语义。
var (
	sharedPool   *pgxpool.Pool
	sharedPoolMu sync.RWMutex
)

// SetSharedPool 由 services 包的 TestMain 调用，让后续 StartPostgres 走共享路径。
//
// 传 nil 重置回 per-test 模式（清理时调用）。
func SetSharedPool(p *pgxpool.Pool) {
	sharedPoolMu.Lock()
	defer sharedPoolMu.Unlock()
	sharedPool = p
}

func getSharedPool() *pgxpool.Pool {
	sharedPoolMu.RLock()
	defer sharedPoolMu.RUnlock()
	return sharedPool
}

// TestCipherKey 测试用主密钥（32 字节 ASCII）。
//
// 业务背景：testutil 给 fixture / integration test 注入 CipherService 时统一用此常量；
// 与 application 层 cipher_service_test 用的 "test-master-key-32-bytes-aaaaa!!" 一致，
// 确保 fixture 写入的密文能被 service 层用同主密钥解密。
const TestCipherKey = "test-master-key-32-bytes-aaaaa!!"

// StartPostgres 启动 postgres:16-alpine 容器、跑迁移、返回连接池 + cleanup。
//
// 行为分流：
//   - sharedPool 已注入（services 包 TestMain 模式）：truncate 共享 pool 后返回它 +
//     no-op cleanup，单次成本 ~10ms 而非 5-15s
//   - sharedPool 未注入（默认 per-test 模式）：dockertest 起新容器，cleanup 销毁
//
// 业务流程（per-test 模式）：
//  1. 连接 docker daemon（OrbStack / Docker Desktop / Linux daemon 任一）
//  2. RunWithOptions 拉起 postgres:16-alpine
//  3. 用 NewPool（含 NUMERIC text codec）连接，最长 retry 60s 等到 ready
//  4. 用 golang-migrate 跑 migrations/
//  5. 返回 pool + cleanup（cleanup 关池 + Purge 容器）
//
// 设计取舍：
//   - 用 NewPool 而不是裸 pgxpool.New：保证测试用的池行为与生产一致（NUMERIC text codec 已注册）
//   - migrationsPath 通过 runtime.Caller 推算，让 testutil 在任意 package 被 import 都能找到
//     server/migrations/，避免 cwd 变化导致迁移失败
//   - container restart_policy=no（测试结束 cleanup 一并删除）
func StartPostgres(t *testing.T) (*pgxpool.Pool, func()) {
	t.Helper()

	if shared := getSharedPool(); shared != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := TruncateAndReseed(ctx, shared); err != nil {
			t.Fatalf("truncate shared pool: %v", err)
		}
		// no-op cleanup —— 共享 pool 由 TestMain 统一负责生命周期
		return shared, func() {}
	}

	pool, cleanup, err := startContainer()
	if err != nil {
		t.Fatalf("start postgres: %v", err)
	}
	// 把 cleanup 错误吸收成 t.Logf（与原行为一致：Purge 失败不 fail 测试）
	wrapped := func() {
		if cerr := cleanup(); cerr != nil {
			t.Logf("postgres cleanup: %v", cerr)
		}
	}
	return pool, wrapped
}

// StartPostgresStandalone 给 services 包的 TestMain 用，签名不依赖 *testing.T。
//
// 业务背景：TestMain 阶段还没有任何 *T 实例可用；这里返回 (pool, cleanup, error) 三元组，
// 调用方自己 panic / log.Fatal 处理 error。
func StartPostgresStandalone() (*pgxpool.Pool, func() error, error) {
	return startContainer()
}

// StartPostgresExclusive 强制起一个独立容器，无视 sharedPool。
//
// 业务背景：services 包默认走 sharedPool 共享模式，但少数测试需要"独占 pool"语义
// —— 例如故意 pool.Close() 模拟 DB 故障的 TestEffectivePermissions_DBErrorReturnsUnavailableSentinel
// —— 这种测试如果关掉共享池会让后续测试全部炸。用本函数显式申请独占容器即可隔离。
//
// 成本与原 per-test 模式相同（5-15s 起容器），仅在需要时使用。
func StartPostgresExclusive(t *testing.T) (*pgxpool.Pool, func()) {
	t.Helper()
	pool, cleanup, err := startContainer()
	if err != nil {
		t.Fatalf("start exclusive postgres: %v", err)
	}
	wrapped := func() {
		if cerr := cleanup(); cerr != nil {
			t.Logf("postgres cleanup: %v", cerr)
		}
	}
	return pool, wrapped
}

// startContainer 是 dockertest 容器启动 + 迁移的共用实现。
//
// 不持有 *testing.T 引用，使 TestMain 与 *T 双路径都能复用。
func startContainer() (*pgxpool.Pool, func() error, error) {
	dPool, err := dockertest.NewPool("")
	if err != nil {
		return nil, nil, fmt.Errorf("dockertest pool: %w", err)
	}
	if err := dPool.Client.Ping(); err != nil {
		return nil, nil, fmt.Errorf("ping docker daemon: %w", err)
	}

	resource, err := dPool.RunWithOptions(&dockertest.RunOptions{
		Repository: "postgres",
		Tag:        "16-alpine",
		Env: []string{
			"POSTGRES_USER=postgres",
			"POSTGRES_PASSWORD=test",
			"POSTGRES_DB=progress_test",
			"POSTGRES_INITDB_ARGS=--no-locale --encoding=UTF8",
		},
	}, func(hc *docker.HostConfig) {
		hc.AutoRemove = true
		hc.RestartPolicy = docker.RestartPolicy{Name: "no"}
	})
	if err != nil {
		return nil, nil, fmt.Errorf("run container: %w", err)
	}

	// 共享池模式下整个 services 包测试可能跑数分钟，给充足上限避免容器自销毁
	if err := resource.Expire(900); err != nil {
		_ = dPool.Purge(resource)
		return nil, nil, fmt.Errorf("set container expire: %w", err)
	}

	port := resource.GetPort("5432/tcp")
	dsn := fmt.Sprintf("postgres://postgres:test@127.0.0.1:%s/progress_test?sslmode=disable", port)

	dPool.MaxWait = 60 * time.Second

	var sqlPool *pgxpool.Pool
	if err := dPool.Retry(func() error {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		p, perr := progressdb.NewPool(ctx, dsn)
		if perr != nil {
			return perr
		}
		if perr := p.Ping(ctx); perr != nil {
			p.Close()
			return perr
		}
		sqlPool = p
		return nil
	}); err != nil {
		_ = dPool.Purge(resource)
		return nil, nil, fmt.Errorf("connect postgres: %w", err)
	}

	if err := applyMigrations(dsn); err != nil {
		sqlPool.Close()
		_ = dPool.Purge(resource)
		return nil, nil, fmt.Errorf("apply migrations: %w", err)
	}

	cleanup := func() error {
		sqlPool.Close()
		if err := dPool.Purge(resource); err != nil {
			return fmt.Errorf("purge container: %w", err)
		}
		return nil
	}
	return sqlPool, cleanup, nil
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
