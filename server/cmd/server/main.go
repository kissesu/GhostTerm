/*
@file main.go
@description progress-server HTTP 入口（Phase 0a 骨架）。
             仅装载 config stub + chi/ogen router，监听 :8080；DB pool / migrations 留给 Phase 0b/1。
@author Atlas.oi
@date 2026-04-29
*/

package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ghostterm/progress-server/internal/api"
)

// configStub 是 Phase 0a 的最小配置占位，避免 main.go 在 Phase 1 真正 config 实现前报错。
//
// Phase 1 会用 internal/config 包替换本 struct，包含 DBURL / JWTSecret / FileStorageDir 等字段。
type configStub struct {
	HTTPAddr string
}

// loadConfigStub 从环境变量读取最小启动参数。
//
// 选型说明：
// - 这里不引入 viper / envconfig，避免 Phase 0a 依赖膨胀
// - HTTP_ADDR 默认 :8080 与 spec §3.3 部署模型一致
func loadConfigStub() *configStub {
	addr := os.Getenv("HTTP_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	return &configStub{HTTPAddr: addr}
}

func main() {
	cfg := loadConfigStub()

	handler, err := api.NewRouter()
	if err != nil {
		log.Fatalf("init router: %v", err)
	}

	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	// 优雅关闭：捕获 SIGINT/SIGTERM 后给 server 10s shutdown 窗口
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("progress-server listening on %s", cfg.HTTPAddr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("shutting down progress-server")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("shutdown error: %v", err)
	}
}
