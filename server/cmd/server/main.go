/*
@file main.go
@description progress-server HTTP 入口。
             加载 config（必填项 fail-fast）→ 建 pgx pool（含 NUMERIC text codec）→
             起 chi/ogen router → 监听 SIGINT/SIGTERM 优雅关闭。
             迁移 NOT auto-applied —— 生产 runbook 用 `migrate` CLI 单独跑（spec §14.1）。
@author Atlas.oi
@date 2026-04-29
*/

package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ghostterm/progress-server/internal/api"
	"github.com/ghostterm/progress-server/internal/config"
	"github.com/ghostterm/progress-server/internal/cron"
	"github.com/ghostterm/progress-server/internal/db"
	"github.com/ghostterm/progress-server/internal/services"
)

func main() {
	// ============================================
	// 第一步：加载配置（必填缺失立即退出）
	// ============================================
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	// ============================================
	// 第二步：建 pgx 连接池（含 NUMERIC text codec 注册）
	// 不在此处跑 migrations —— 生产 runbook 用 migrate CLI（避免 server 重启副作用）
	// ============================================
	bootCtx, bootCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer bootCancel()
	pool, err := db.NewPool(bootCtx, cfg.DBURL)
	if err != nil {
		log.Fatalf("db pool: %v", err)
	}
	defer pool.Close()

	// ============================================
	// 第三步：装配 services
	// Phase 2 AuthService / Phase 3 RBACService / Phase 4-9 worker A-F services
	// ============================================
	authSvc, err := services.NewAuthService(services.AuthServiceDeps{
		Pool:          pool,
		AccessSecret:  cfg.JWTAccessSecret,
		RefreshSecret: cfg.JWTRefreshSecret,
		AccessTTL:     cfg.JWTAccessTTL,
		RefreshTTL:    cfg.JWTRefreshTTL,
		BcryptCost:    cfg.BcryptCost,
	})
	if err != nil {
		log.Fatalf("init auth service: %v", err)
	}

	rbacSvc, err := services.NewRBACService(services.RBACServiceDeps{
		Pool: pool,
		// CacheTTL 留默认 5 分钟（NewRBACService 内部判定）
	})
	if err != nil {
		log.Fatalf("init rbac service: %v", err)
	}

	// Atlas 模块用户管理（仅超管可调用）
	userSvc, err := services.NewUserService(services.UserServiceDeps{
		Pool:       pool,
		BcryptCost: cfg.BcryptCost,
	})
	if err != nil {
		log.Fatalf("init user service: %v", err)
	}

	// 注：原 customerSvc 已于 2026-04-30 移除（客户从独立资源降级为 projects.customer_label 字段）

	projectSvc, err := services.NewProjectService(services.ProjectServiceDeps{Pool: pool})
	if err != nil {
		log.Fatalf("init project service: %v", err)
	}

	// FileService 需要存储根目录 + 单文件大小上限（spec §6.6 默认 100MB）
	// MB → 字节换算在 main.go 完成，service 内部不再做单位转换
	fileSvc, err := services.NewFileService(services.FileServiceDeps{
		Pool:         pool,
		StoragePath:  cfg.FileStoragePath,
		MaxSizeBytes: int64(cfg.FileMaxSizeMB) * 1024 * 1024,
	})
	if err != nil {
		log.Fatalf("init file service: %v", err)
	}

	feedbackSvc, err := services.NewFeedbackService(services.FeedbackServiceDeps{Pool: pool})
	if err != nil {
		log.Fatalf("init feedback service: %v", err)
	}

	quoteSvc, err := services.NewQuoteService(pool)
	if err != nil {
		log.Fatalf("init quote service: %v", err)
	}

	// ============================================
	// Phase 12：WSHub + NotificationService + 后台 worker
	//
	// 业务背景：
	//  - WSHub 必须在 NotificationService 之前 —— Notification 持有 hub 引用
	//  - feedback / payment service 也持有 notif 引用（new_feedback / settlement_received）
	//    所以这两个 service 在 notif 之后构造（覆盖前面已经写过的 feedbackSvc / paymentSvc）
	// ============================================
	wsHub := services.NewWSHub()
	notifSvc, err := services.NewNotificationService(services.NotificationServiceDeps{
		Pool: pool,
		Hub:  wsHub,
	})
	if err != nil {
		log.Fatalf("init notification service: %v", err)
	}

	// 重新构造 feedback / payment service，注入通知（参见 worker D / F minimal touch）
	feedbackSvc, err = services.NewFeedbackService(services.FeedbackServiceDeps{
		Pool:                pool,
		NotificationService: notifSvc,
	})
	if err != nil {
		log.Fatalf("init feedback service (with notif): %v", err)
	}
	paymentSvc, err := services.NewPaymentService(services.PaymentServiceDeps{
		Pool:                pool,
		NotificationService: notifSvc,
	})
	if err != nil {
		log.Fatalf("init payment service (with notif): %v", err)
	}

	// ============================================
	// 第四步：装配 router + healthz（含 DB ping）
	// ============================================
	handler, err := api.NewRouter(api.RouterDeps{
		Pool:                pool,
		AuthService:         authSvc,
		RBACService:         rbacSvc,
		UserService:         userSvc,
		ProjectService:      projectSvc,
		FileService:         fileSvc,
		FeedbackService:     feedbackSvc,
		QuoteService:        quoteSvc,
		PaymentService:      paymentSvc,
		NotificationService: notifSvc,
		WSHub:               wsHub,
	})
	if err != nil {
		log.Fatalf("init router: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", healthzHandler(pool))
	mux.Handle("/", handler)

	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	// ============================================
	// 第四步：监听信号 + 优雅关闭
	// ============================================
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// ============================================
	// Phase 12：后台 worker（注册到 ctx，SIGINT/SIGTERM 后随 ctx 退出）
	//   - notification outbox：每 2 秒扫描 delivered_at IS NULL 推送
	//   - deadline checker   ：每 30 分钟扫 projects.deadline_at 发提醒
	// ============================================
	outboxWorker := services.NewOutboxWorker(services.OutboxWorkerDeps{Svc: notifSvc})
	go outboxWorker.Run(ctx)

	deadlineChecker, err := cron.NewDeadlineChecker(cron.DeadlineCheckerDeps{
		Pool:     pool,
		NotifSvc: notifSvc,
	})
	if err != nil {
		log.Fatalf("init deadline checker: %v", err)
	}
	go deadlineChecker.Run(ctx)

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
	// pool.Close 在 defer 里执行
}

// healthzHandler 覆盖 chi router 中的 /healthz 占位实现，加上真实的 DB ping。
//
// 业务背景：spec §14 健康检查要同时反映 HTTP server 与 DB 连接状态；
// 单纯 200/ok 不能让 docker compose healthcheck / Caddy 上游剔除发现 DB 失联的实例。
//
// 返回：
//   - 200 + {"status":"ok","db":"ok"}：HTTP 与 DB 均正常
//   - 503 + {"status":"degraded","db":"<err>"}：DB ping 失败（不停机但暴露问题）
func healthzHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		w.Header().Set("Content-Type", "application/json")
		body := map[string]string{"status": "ok", "db": "ok"}
		status := http.StatusOK
		if err := pool.Ping(ctx); err != nil {
			body["status"] = "degraded"
			body["db"] = err.Error()
			status = http.StatusServiceUnavailable
		}
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(body)
	}
}
