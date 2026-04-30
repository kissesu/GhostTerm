/*
@file notification_outbox_worker.go
@description 通知 outbox worker（Phase 12）：周期 ticker 驱动 NotificationService.FlushOutbox。

             业务模式（v2 part2 §W3 outbox pattern）：
             - 业务 service 在事务内 INSERT notifications（delivered_at IS NULL）
             - 事务 commit 后才被本 worker 看到（避免 dirty read）
             - 本 worker 每 2 秒扫描一次：调 hub.Broadcast → 标记 delivered_at
             - hub 推送失败不阻断标记（用户离线仍写 delivered_at；下次 List 时主动拉取）

             生命周期：
             - main.go 用 errgroup 拉起 worker.Run(ctx)
             - ctx.Done 时退出循环；ticker.Stop 释放资源
             - panic 由 recover 兜底，不让单个 flush 失败拖垮 worker
@author Atlas.oi
@date 2026-04-29
*/

package services

import (
	"context"
	"log"
	"time"
)

// 默认 flush 周期；spec §8 通知机制要求"近实时"，2 秒可接受。
const defaultOutboxInterval = 2 * time.Second

// OutboxWorker 周期触发 NotificationService.FlushOutbox。
type OutboxWorker struct {
	svc      NotificationService
	interval time.Duration
}

// OutboxWorkerDeps 装配 OutboxWorker。
//
// Interval 留 0 时取 defaultOutboxInterval。
type OutboxWorkerDeps struct {
	Svc      NotificationService
	Interval time.Duration
}

// NewOutboxWorker 构造 outbox worker；svc 为 nil 时返回 nil（main.go 据此跳过启动）。
func NewOutboxWorker(deps OutboxWorkerDeps) *OutboxWorker {
	if deps.Svc == nil {
		return nil
	}
	itv := deps.Interval
	if itv <= 0 {
		itv = defaultOutboxInterval
	}
	return &OutboxWorker{svc: deps.Svc, interval: itv}
}

// Run 阻塞运行 worker，直到 ctx.Done。
//
// 业务流程：
//  1. 创建 ticker，按 interval 触发 flush
//  2. flush 内 panic 用 recover 兜底（log + 继续下一轮，不让 worker 崩）
//  3. ctx.Done 时退出循环
func (w *OutboxWorker) Run(ctx context.Context) {
	if w == nil {
		return
	}
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()

	log.Printf("notification outbox worker started (interval=%s)", w.interval)
	for {
		select {
		case <-ctx.Done():
			log.Println("notification outbox worker stopping")
			return
		case <-ticker.C:
			w.tick(ctx)
		}
	}
}

// tick 单次触发；用 defer recover 防止 service 内的意外 panic 拖垮 worker。
func (w *OutboxWorker) tick(ctx context.Context) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("notification outbox worker panic: %v", r)
		}
	}()
	if err := w.svc.FlushOutbox(ctx); err != nil {
		log.Printf("notification outbox flush error: %v", err)
	}
}
