// @file main_test.go
// @description services 包级 TestMain：起一个共享 postgres 容器供包内全部测试复用，
//              避免 per-test 容器累计成本撞 CI 120s 超时（重构前 services 包 130+ 测试
//              在 GHA runner 上稳定 timeout，重构后 30-60s 完成）。
//
// 工作原理：
//   - TestMain 调 testutil.StartPostgresStandalone 起容器、跑迁移
//   - SetSharedPool 让 testutil.StartPostgres 进入 fast path（truncate 复用而非起新容器）
//   - 包内所有测试通过 fixtures.NewTestDB / testutil.StartPostgres 拿到的都是同一 pool
//   - 每个测试结束 cleanup 是 no-op；下一个测试调用前自动 TruncateAndReseed
//   - m.Run() 返回后销毁容器并清 sharedPool
//
// 影响范围：仅 services 包；handlers/router/middleware/integration 包不调
// SetSharedPool，仍维持 per-test 容器隔离语义不变。
//
// @author Atlas.oi
// @date 2026-05-09

package services_test

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/ghostterm/progress-server/internal/testutil"
)

func TestMain(m *testing.M) {
	pool, cleanup, err := testutil.StartPostgresStandalone()
	if err != nil {
		fmt.Fprintf(os.Stderr, "services TestMain: start postgres: %v\n", err)
		os.Exit(1)
	}
	// 在 0001 seed 干净状态下拍 role_permissions 快照，供后续 TruncateAndReseed 还原
	captureCtx, captureCancel := context.WithTimeout(context.Background(), 10*time.Second)
	if err := testutil.CaptureSeed(captureCtx, pool); err != nil {
		captureCancel()
		_ = cleanup()
		fmt.Fprintf(os.Stderr, "services TestMain: capture seed: %v\n", err)
		os.Exit(1)
	}
	captureCancel()
	testutil.SetSharedPool(pool)

	code := m.Run()

	testutil.SetSharedPool(nil)
	if cerr := cleanup(); cerr != nil {
		fmt.Fprintf(os.Stderr, "services TestMain: cleanup: %v\n", cerr)
	}
	os.Exit(code)
}
