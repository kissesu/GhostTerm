/*
@file e2e_setup.go
@description e2e 测试套件的 TestMain 入口与共享资源管理。

             与 integration test 的关键差异（v1 §13）：
             - integration test：每个测试函数自起一个 Postgres 容器（行为隔离）
             - e2e test         ：整个 package 共用 1 个 Postgres + 1 个 server 进程，
                                  按 flow 串行复用（行为依赖业务流，避免 N×60s 启动开销）

             启动顺序（业务流程）：
              1. 启动 postgres:16-alpine 容器（dockertest，MaxWait 60s）
              2. 跑 0001 + 0002 迁移（golang-migrate）
              3. go build ./cmd/server 产出 bin/e2e-server 二进制
              4. 用随机端口 + 临时存储目录 + 测试用 JWT secrets 启动 server 子进程
              5. 健康探活：等 /healthz 返回 200（最多 30s）
              6. seed 全套测试用户（1 super admin + 1 cs + 2 dev）
              7. 把 baseURL / 用户清单写入 e2eEnv 全局，供各 flow 测试用例消费

             关闭顺序（TestMain return 前）：
              - SIGTERM server 子进程；等待 5s 优雅退出，超时 SIGKILL
              - dockertest Purge 容器
              - 删除临时文件存储目录

@author Atlas.oi
@date 2026-04-29
*/

package e2e

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"syscall"
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

// e2eEnv 是 TestMain 在 setup 阶段填充的全局环境。
//
// 业务背景：e2e 各 flow 测试都通过 e2eEnv 读取 baseURL / pool / 测试用户；
// 集中存放避免每个 flow 自带状态。所有读取都在 setup 完成后，
// TestMain return 前由 cleanup 清理；测试函数中只读不写。
type e2eEnvironment struct {
	BaseURL     string
	Pool        *pgxpool.Pool
	StorageDir  string
	SuperAdmin  testUser
	CS          testUser
	Dev1        testUser
	Dev2        testUser
}

// e2eEnv 是包级全局环境（仅 TestMain 写一次，flow 测试只读）。
var e2eEnv *e2eEnvironment

// 测试时使用的 JWT secrets / bcrypt cost / Token TTL 常量
//
// 业务背景：
//   - bcrypt MinCost=4 让 e2e seed 单次<1s（生产 BCRYPT_COST=12）
//   - Access TTL 短到 5s 让 token-version-bump 类测试可在不等表的前提下验证
//   - JWT 密钥固定常量，e2e 跑完即销毁；不与生产密钥共享
const (
	e2eBcryptCost     = 4
	e2eAccessTTL      = "30m"
	e2eRefreshTTL     = "24h"
	e2eAccessSecret   = "e2e-access-secret-with-32-bytes!" // 32 bytes
	e2eRefreshSecret  = "e2e-refresh-secret-32bytes-min!!"
	e2eHealthzTimeout = 30 * time.Second
	e2eShutdownGrace  = 5 * time.Second
)

// TestMain 是 e2e 包的入口，setup → run → teardown。
//
// 业务流程：
//   1. setup() 启动 postgres / server / seed users
//   2. m.Run() 跑全部 flow 测试
//   3. teardown() 关闭 server / 清容器 / 删存储目录
//
// 任何 setup 阶段错误都通过 fmt.Println + os.Exit(1)（TestMain 不能 t.Fatal）。
func TestMain(m *testing.M) {
	teardown, err := setup()
	if err != nil {
		fmt.Fprintf(os.Stderr, "e2e setup failed: %v\n", err)
		if teardown != nil {
			teardown()
		}
		os.Exit(1)
	}

	code := m.Run()

	teardown()
	os.Exit(code)
}

// setup 执行全部启动步骤；返回 teardown 闭包（无论是否失败都调用 teardown 释放已分配资源）。
func setup() (func(), error) {
	// ============================================================
	// 第一步：dockertest 启 postgres:16-alpine
	// ============================================================
	dPool, err := dockertest.NewPool("")
	if err != nil {
		return nil, fmt.Errorf("dockertest.NewPool: %w", err)
	}
	if err := dPool.Client.Ping(); err != nil {
		return nil, fmt.Errorf("docker daemon ping: %w", err)
	}
	dPool.MaxWait = 60 * time.Second

	resource, err := dPool.RunWithOptions(&dockertest.RunOptions{
		Repository: "postgres",
		Tag:        "16-alpine",
		Env: []string{
			"POSTGRES_USER=postgres",
			"POSTGRES_PASSWORD=test",
			"POSTGRES_DB=progress_e2e",
			"POSTGRES_INITDB_ARGS=--no-locale --encoding=UTF8",
		},
	}, func(hc *docker.HostConfig) {
		hc.AutoRemove = true
		hc.RestartPolicy = docker.RestartPolicy{Name: "no"}
	})
	if err != nil {
		return nil, fmt.Errorf("start postgres: %w", err)
	}
	// 让容器在测试结束前不被 dockertest 自动 Expire（180s 给 e2e 全套测试余量）
	if err := resource.Expire(180); err != nil {
		_ = dPool.Purge(resource)
		return nil, fmt.Errorf("expire container: %w", err)
	}

	// dockertest 资源已分配，下面任何步骤失败都要 Purge
	teardownPurge := func() {
		if err := dPool.Purge(resource); err != nil {
			fmt.Fprintf(os.Stderr, "warn: purge container: %v\n", err)
		}
	}

	pgPort := resource.GetPort("5432/tcp")
	dsn := fmt.Sprintf("postgres://postgres:test@127.0.0.1:%s/progress_e2e?sslmode=disable", pgPort)

	// 等 Postgres ready
	var pgPool *pgxpool.Pool
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
		pgPool = p
		return nil
	}); err != nil {
		teardownPurge()
		return nil, fmt.Errorf("connect postgres: %w", err)
	}
	teardownPool := func() { pgPool.Close() }

	// ============================================================
	// 第二步：跑 migrations
	// ============================================================
	migDir, err := migrationsDir()
	if err != nil {
		teardownPool()
		teardownPurge()
		return nil, err
	}
	mig, err := migrate.New("file://"+migDir, dsn)
	if err != nil {
		teardownPool()
		teardownPurge()
		return nil, fmt.Errorf("migrate.New: %w", err)
	}
	if err := mig.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		_, _ = mig.Close()
		teardownPool()
		teardownPurge()
		return nil, fmt.Errorf("migrate up: %w", err)
	}
	_, _ = mig.Close()

	// 注：e2e 用 postgres 超级用户连，与 integration tests 保持一致行为。
	// 真正的 RLS 隔离（progress_app NOBYPASSRLS）需要 ops 在 0001 后单独
	// 设密码 + 重新部署 server，在 e2e 环境内成本过高。
	// 受影响 RLS 测试通过 dev_earnings_view security_barrier 间接验证。

	// ============================================================
	// 第三步：编译 server 二进制
	// ============================================================
	binPath, err := buildServerBinary()
	if err != nil {
		teardownPool()
		teardownPurge()
		return nil, err
	}
	teardownBin := func() {
		// bin 可能被多个 e2e 进程复用；这里只删本进程产出的 unique path
		_ = os.Remove(binPath)
	}

	// ============================================================
	// 第四步：启动 server 子进程（随机端口 + 临时存储目录）
	// ============================================================
	port, err := allocFreePort()
	if err != nil {
		teardownBin()
		teardownPool()
		teardownPurge()
		return nil, fmt.Errorf("alloc free port: %w", err)
	}
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	baseURL := "http://" + addr

	storageDir, err := os.MkdirTemp("", "ghostterm-e2e-files-")
	if err != nil {
		teardownBin()
		teardownPool()
		teardownPurge()
		return nil, fmt.Errorf("mkdir temp storage: %w", err)
	}
	teardownStorage := func() { _ = os.RemoveAll(storageDir) }

	cmd := exec.Command(binPath)
	cmd.Env = append(os.Environ(),
		"DATABASE_URL="+dsn,
		"HTTP_ADDR="+addr,
		"JWT_ACCESS_SECRET="+e2eAccessSecret,
		"JWT_REFRESH_SECRET="+e2eRefreshSecret,
		"JWT_ACCESS_TTL="+e2eAccessTTL,
		"JWT_REFRESH_TTL="+e2eRefreshTTL,
		fmt.Sprintf("BCRYPT_COST=%d", e2eBcryptCost),
		"FILE_STORAGE_PATH="+storageDir,
		"FILE_MAX_SIZE_MB=10",
	)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	// 独立 process group，TestMain 退出时可整组 kill
	cmd.SysProcAttr = procAttr()
	if err := cmd.Start(); err != nil {
		teardownStorage()
		teardownBin()
		teardownPool()
		teardownPurge()
		return nil, fmt.Errorf("start server: %w", err)
	}
	teardownServer := func() {
		// 优雅关闭：SIGTERM → 等 5s → SIGKILL
		_ = cmd.Process.Signal(syscall.SIGTERM)
		done := make(chan struct{})
		go func() {
			_, _ = cmd.Process.Wait()
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(e2eShutdownGrace):
			_ = cmd.Process.Kill()
			<-done
		}
	}

	// 健康探活
	if err := waitHealthz(baseURL, e2eHealthzTimeout); err != nil {
		teardownServer()
		teardownStorage()
		teardownBin()
		teardownPool()
		teardownPurge()
		return nil, fmt.Errorf("wait healthz: %w", err)
	}

	// ============================================================
	// 第五步：seed 测试用户
	// ============================================================
	users, err := seedTestUsers(pgPool)
	if err != nil {
		teardownServer()
		teardownStorage()
		teardownBin()
		teardownPool()
		teardownPurge()
		return nil, fmt.Errorf("seed users: %w", err)
	}

	e2eEnv = &e2eEnvironment{
		BaseURL:    baseURL,
		Pool:       pgPool,
		StorageDir: storageDir,
		SuperAdmin: users.superAdmin,
		CS:         users.cs,
		Dev1:       users.dev1,
		Dev2:       users.dev2,
	}

	// 总 teardown 按反向顺序释放
	teardown := func() {
		teardownServer()
		teardownStorage()
		teardownBin()
		teardownPool()
		teardownPurge()
	}
	return teardown, nil
}

// migrationsDir 返回 server/migrations 的绝对路径（独立于 cwd）。
func migrationsDir() (string, error) {
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		return "", errors.New("runtime.Caller(0) failed")
	}
	abs, err := filepath.Abs(filepath.Join(filepath.Dir(thisFile), "..", "..", "migrations"))
	if err != nil {
		return "", err
	}
	return abs, nil
}

// serverPackagePath 返回 ./cmd/server 的绝对路径。
func serverPackagePath() (string, error) {
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		return "", errors.New("runtime.Caller(0) failed")
	}
	abs, err := filepath.Abs(filepath.Join(filepath.Dir(thisFile), "..", "..", "cmd", "server"))
	if err != nil {
		return "", err
	}
	return abs, nil
}

// buildServerBinary 编译 ./cmd/server 到唯一临时路径并返回。
//
// 业务背景：
//   - e2e 必须用真实编译产物运行，证明业务流程在编译产物层面工作
//   - 用 os.MkdirTemp 隔离每次运行，避免并发 TestMain 互踩
func buildServerBinary() (string, error) {
	pkgPath, err := serverPackagePath()
	if err != nil {
		return "", err
	}
	tmpDir, err := os.MkdirTemp("", "ghostterm-e2e-bin-")
	if err != nil {
		return "", fmt.Errorf("mkdir temp bin dir: %w", err)
	}
	binName := "e2e-server"
	if runtime.GOOS == "windows" {
		binName += ".exe"
	}
	out := filepath.Join(tmpDir, binName)

	cmd := exec.Command("go", "build", "-o", out, pkgPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("go build: %w", err)
	}
	return out, nil
}

// allocFreePort 让 OS 分配一个空闲 TCP 端口；listener 立即关闭，端口短暂可被他人占用，
// 但 e2e 单进程串行启动，竞争极小。
func allocFreePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

// waitHealthz 轮询 GET /healthz，最多 timeout 长度。
//
// 业务背景：server 启动包含 DB pool / handler 装配；冷启动可能 1-3s
// （macOS arm64 OrbStack 极端可达 5-10s）。30s 是宽裕保守值。
func waitHealthz(baseURL string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: 1 * time.Second}
	var lastErr error
	for time.Now().Before(deadline) {
		resp, err := client.Get(baseURL + "/healthz")
		if err != nil {
			lastErr = err
			time.Sleep(200 * time.Millisecond)
			continue
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode == http.StatusOK {
			return nil
		}
		lastErr = fmt.Errorf("status=%d", resp.StatusCode)
		time.Sleep(200 * time.Millisecond)
	}
	if lastErr == nil {
		lastErr = errors.New("timeout")
	}
	return lastErr
}
