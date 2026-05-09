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
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/getsentry/sentry-go"
	sentryhttp "github.com/getsentry/sentry-go/http"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ghostterm/progress-server/internal/api"
	apimiddleware "github.com/ghostterm/progress-server/internal/api/middleware"
	"github.com/ghostterm/progress-server/internal/config"
	"github.com/ghostterm/progress-server/internal/cron"
	"github.com/ghostterm/progress-server/internal/db"
	"github.com/ghostterm/progress-server/internal/services"
)

func main() {
	// ============================================
	// 第零步：GlitchTip 错误监控初始化（先于 config 加载，让 config 错误也能上报）
	// 业务背景：方案 B 明文 http；DSN/Release/Environment 走 systemd EnvironmentFile
	// SENTRY_DSN 未设时静默跳过监控，不阻塞 server 启动
	// ============================================
	if dsn := os.Getenv("SENTRY_DSN"); dsn != "" {
		if err := sentry.Init(sentry.ClientOptions{
			Dsn:              dsn,
			Release:          os.Getenv("SENTRY_RELEASE"),
			Environment:      os.Getenv("SENTRY_ENVIRONMENT"),
			SendDefaultPII:   false,
			SampleRate:       1.0,
			TracesSampleRate: 0.01,
			AttachStacktrace: true,
		}); err != nil {
			log.Printf("[sentry] init failed: %v (monitoring disabled)", err)
		} else {
			defer sentry.Flush(2 * time.Second)
			log.Printf("[sentry] enabled release=%q env=%q", os.Getenv("SENTRY_RELEASE"), os.Getenv("SENTRY_ENVIRONMENT"))
		}
	} else {
		log.Println("[sentry] SENTRY_DSN not set, monitoring disabled")
	}

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

	// 安全 review H1：fail-fast 校验 PG 连接以 progress_app 角色登录
	//
	// security_audit_log 的 INSERT-only RULE 与 RLS 策略都依赖 session_user='progress_app'
	// 才能 RAISE / 拒写。如果 DATABASE_URL 误配为 postgres superuser（运维抢修 / 配置漂移），
	// 整个 append-only 防护与 RLS 策略静默失效——审计可被擦除、行级权限被绕过。
	//
	// 启动期一次 SELECT current_user 是 ~ms 成本的硬墙：发现非 progress_app 立即 panic
	// 退出，比让生产跑了 8 小时才发现"为啥审计都没了"安全得多。
	if err := assertProgressAppRole(bootCtx, pool); err != nil {
		log.Fatalf("db role: %v", err)
	}

	// ============================================
	// 第三步：装配 services
	// Phase 2 AuthService / Phase 3 RBACService / Phase 4-9 worker A-F services
	// ============================================
	// finding #20：安全审计 service —— auth/user/file/permissions 全部敏感路径共用，
	// 必须先于其它 service 构造让它们能在构造期注入；缺失即启动期 fail-fast
	auditSvc, err := services.NewAuditService(pool)
	if err != nil {
		log.Fatalf("init audit service: %v", err)
	}

	authSvc, err := services.NewAuthService(services.AuthServiceDeps{
		Pool:          pool,
		AccessSecret:  cfg.JWTAccessSecret,
		RefreshSecret: cfg.JWTRefreshSecret,
		AccessTTL:     cfg.JWTAccessTTL,
		RefreshTTL:    cfg.JWTRefreshTTL,
		BcryptCost:    cfg.BcryptCost,
		Audit:         auditSvc,
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
		Audit:      auditSvc,
	})
	if err != nil {
		log.Fatalf("init user service: %v", err)
	}

	// 注：原 customerSvc 已于 2026-04-30 移除（客户从独立资源降级为 projects.customer_label 字段）

	// EventHub 提前构造：projectSvc 需要注入（spec v3.5 §6 P1.5）；
	// WSHub 仍在 Phase 12 块内构造（依赖 notifSvc 顺序不变）
	eventHub := services.NewEventHub()

	projectSvc, err := services.NewProjectService(services.ProjectServiceDeps{Pool: pool, Hub: eventHub})
	if err != nil {
		log.Fatalf("init project service: %v", err)
	}

	// FileService 需要存储根目录 + 单文件大小上限（spec §6.6 默认 100MB）
	// MB → 字节换算在 main.go 完成，service 内部不再做单位转换
	fileSvc, err := services.NewFileService(services.FileServiceDeps{
		Pool:         pool,
		StoragePath:  cfg.FileStoragePath,
		MaxSizeBytes: int64(cfg.FileMaxSizeMB) * 1024 * 1024,
		Audit:        auditSvc,
	})
	if err != nil {
		log.Fatalf("init file service: %v", err)
	}

	// finding #4：列级加密 service —— feedback/payment/activity 三个 service 共用
	cipherSvc, err := services.NewCipherService(pool, cfg.DataKey)
	if err != nil {
		log.Fatalf("init cipher service: %v", err)
	}

	feedbackSvc, err := services.NewFeedbackService(services.FeedbackServiceDeps{
		Pool:   pool,
		Cipher: cipherSvc,
	})
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
	// eventHub 已在上方 projectSvc 构造前声明（spec v3.5 §6 P1.5），此处直接使用
	notifSvc, err := services.NewNotificationService(services.NotificationServiceDeps{
		Pool: pool,
		Hub:  wsHub,
	})
	if err != nil {
		log.Fatalf("init notification service: %v", err)
	}

	// 重新构造 feedback / payment service，注入通知 + SSE hub（spec v3.5 §6 P1.6）
	feedbackSvc, err = services.NewFeedbackService(services.FeedbackServiceDeps{
		Pool:                pool,
		NotificationService: notifSvc,
		Cipher:              cipherSvc,
		Hub:                 eventHub,
	})
	if err != nil {
		log.Fatalf("init feedback service (with notif): %v", err)
	}
	paymentSvc, err := services.NewPaymentService(services.PaymentServiceDeps{
		Pool:                pool,
		NotificationService: notifSvc,
		Cipher:              cipherSvc,
		Hub:                 eventHub,
	})
	if err != nil {
		log.Fatalf("init payment service (with notif): %v", err)
	}

	// ============================================
	// 第四步：装配 router + healthz（含 DB ping）
	// ============================================
	// finding #10：解析受信反代白名单。空串 = 直连模式不信任任何代理头；
	// 非法 CIDR 立即 fail-fast 不让 server 起来带病运行
	trustedProxies, err := apimiddleware.ParseTrustedProxiesEnv(cfg.TrustedProxies)
	if err != nil {
		log.Fatalf("config: TRUSTED_PROXIES invalid CIDR: %v", err)
	}

	// finding #13：解析 CORS 白名单（逗号分隔 origin 列表）
	// 空白条目自动剔除；router 内做精确匹配防前缀绕过
	allowedOrigins := splitNonEmpty(cfg.AllowedOrigins, ",")
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
		EventHub:            eventHub,
		Cipher:              cipherSvc,
		Audit:               auditSvc,
		// finding #7：登录与 refresh 速率限制由 env 注入，便于按部署调参；
		// 缺省值见 router.go 内 rlCfg 默认值（5/10/30 per min）
		RateLimit: &apimiddleware.RateLimitConfig{
			LoginPerMinPerIP:   cfg.RateLimitLoginPerMinPerIP,
			LoginPerMinPerUser: cfg.RateLimitLoginPerMinPerUser,
			RefreshPerMinPerIP: cfg.RateLimitRefreshPerMinPerIP,
			TTL:                10 * time.Minute,
		},
		TrustedProxies: trustedProxies,
		AllowedOrigins: allowedOrigins,
		// finding #14：multipart 文件上传专用 body 上限 = 单文件上限 + 10MB 余量
		// （余量给 boundary / form 字段 / Base64 膨胀；超量直接拒，不让 oas
		// 解码侧 ParseMultipartForm 写满临时盘）
		FileUploadBodyLimitBytes: int64(cfg.FileMaxSizeMB)*1024*1024 + 10*1024*1024,
	})
	if err != nil {
		log.Fatalf("init router: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", healthzHandler(pool))
	mux.Handle("/", handler)

	// finding #14：HTTP server 超时收紧。
	//
	// 业务背景：
	//  - 旧版只设 ReadHeaderTimeout，慢连接 body 阶段可挂任意时长耗 worker
	//  - WriteTimeout 5min 给文件下载流式留足时间（100MB / 1Mbps ~13min；
	//    实际本机 / 局域网部署足够 5min；公网慢用户可能 timeout 但属于可接受退化）
	//  - IdleTimeout 120s：keep-alive 连接闲置上限，比默认无限好
	//  - MaxHeaderBytes 1MB：防巨型 header 攻击
	// sentryhttp 包 mux：自动 capture handler panic + 注入 sentry hub 到 request context
	// Repanic=true 让 panic 上报后重新抛出，让上层 chi recovery middleware 仍能正常处理（500 响应）
	sentryHandler := sentryhttp.New(sentryhttp.Options{
		Repanic:         true,
		WaitForDelivery: false,
		Timeout:         2 * time.Second,
	})

	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           sentryHandler.Handle(mux),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      5 * time.Minute,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
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

	// 异步预热公网 IP 缓存（用户审计需求 2026-05-03"需要公网IP而不是局域网IP"）
	// 不阻塞启动；首次请求若 cached 未就绪走 loopback 兜底
	apimiddleware.PrimePublicIP()

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

// splitNonEmpty 用 sep 切分字符串后剔除空白条目；用于解析逗号分隔的 env 值。
//
// 业务背景：env 形如 "tauri://localhost,http://localhost:1420" 需 split 后送给
// router 的 AllowedOrigins []string；strings.Split 会留下连续逗号产生的空串
// 让白名单意外包含 ""（精确匹配 origin=="" 的情况），必须显式过滤。
func splitNonEmpty(s, sep string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, sep)
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// assertProgressAppRole 校验 PG 连接以非 superuser 的应用专用角色登录。
//
// 安全 review H1：security_audit_log 的 INSERT-only RULE / RLS 策略 / payments
// dev_settlement insert RLS 都假设 session_user='progress_app'。误连 superuser
// 让所有应用层防护静默失效（superuser BYPASS RLS + 不触发 RULE）。
//
// 不直接拼 fmt.Errorf 是为了让运维 grep error 时一眼看出是 H1 触发：
// "expected role 'progress_app' but DATABASE_URL points to '<actual>'"。
func assertProgressAppRole(ctx context.Context, pool *pgxpool.Pool) error {
	const requiredRole = "progress_app"
	var sessionUser string
	if err := pool.QueryRow(ctx, "SELECT session_user").Scan(&sessionUser); err != nil {
		return fmt.Errorf("query session_user: %w", err)
	}
	if sessionUser != requiredRole {
		return fmt.Errorf("expected role %q but DATABASE_URL points to %q (security review H1: superuser bypasses RLS + audit RULE)", requiredRole, sessionUser)
	}
	return nil
}
