/*
@file deadline_check.go
@description 截止日期检查 cron task（Phase 12）：
             周期扫描 projects.deadline_at，给即将到期 / 已超期项目的 holder_user 发通知。

             业务规则（spec §8 通知机制）：
             - status NOT IN (cancelled, archived) 的项目才参与
             - days_until_deadline <= 7 → 发 deadline_approaching（每 24 小时去重一次）
             - days_until_deadline <= 0 → 发 overdue（每 24 小时去重一次）
             - 通知接收人 = projects.holder_user_id；为 nil 时跳过该项目
             - 调用 NotificationService.Create（走 insert_notification_secure SECURITY DEFINER）

             执行频率：每 30 分钟扫描一次（spec §8 + plan §12.6）。
             每次扫描在独立事务中完成；单条项目处理失败不阻断后续。

             去重策略：扫 notifications 表近 24 小时是否已有同类型 + 同 project_id 的通知；
             有则跳过（避免短时间内重复打扰用户）。
@author Atlas.oi
@date 2026-04-29
*/

package cron

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	progressdb "github.com/ghostterm/progress-server/internal/db"
	"github.com/ghostterm/progress-server/internal/services"
)

const (
	// 触达阈值：deadline 还剩 <= 7 天 → deadline_approaching
	deadlineApproachingDays = 7

	// 去重窗口：同一类型 + 同 project 24h 内只发一次
	dedupeWindow = 24 * time.Hour

	// 默认 cron 周期：30 分钟（spec §8）
	defaultCheckInterval = 30 * time.Minute
)

// DeadlineChecker 周期扫描项目截止日期 → 发送通知。
type DeadlineChecker struct {
	pool     *pgxpool.Pool
	notifSvc services.NotificationService
	interval time.Duration
	now      func() time.Time // 注入便于测试
}

// DeadlineCheckerDeps 装配。
type DeadlineCheckerDeps struct {
	Pool     *pgxpool.Pool
	NotifSvc services.NotificationService
	Interval time.Duration
	Now      func() time.Time
}

// NewDeadlineChecker 构造 cron worker。pool / notifSvc 缺失时返回 error（fail-fast）。
func NewDeadlineChecker(deps DeadlineCheckerDeps) (*DeadlineChecker, error) {
	if deps.Pool == nil {
		return nil, errors.New("deadline_check: pool is required")
	}
	if deps.NotifSvc == nil {
		return nil, errors.New("deadline_check: notif svc is required")
	}
	itv := deps.Interval
	if itv <= 0 {
		itv = defaultCheckInterval
	}
	nowFn := deps.Now
	if nowFn == nil {
		nowFn = time.Now
	}
	return &DeadlineChecker{
		pool:     deps.Pool,
		notifSvc: deps.NotifSvc,
		interval: itv,
		now:      nowFn,
	}, nil
}

// Run 阻塞运行 worker 直到 ctx.Done。
func (c *DeadlineChecker) Run(ctx context.Context) {
	if c == nil {
		return
	}
	// 启动时立即跑一次，避免等 30 分钟才首发
	c.tick(ctx)

	ticker := time.NewTicker(c.interval)
	defer ticker.Stop()

	log.Printf("deadline checker started (interval=%s)", c.interval)
	for {
		select {
		case <-ctx.Done():
			log.Println("deadline checker stopping")
			return
		case <-ticker.C:
			c.tick(ctx)
		}
	}
}

// tick 单次扫描；recover 防 panic 拖垮 worker。
func (c *DeadlineChecker) tick(ctx context.Context) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("deadline checker panic: %v", r)
		}
	}()
	if err := c.CheckDeadlines(ctx); err != nil {
		log.Printf("deadline checker error: %v", err)
	}
}

// projectRow 单条项目快照。
type projectRow struct {
	ID         int64
	Name       string
	Status     string
	DeadlineAt time.Time
	HolderUser *int64
}

// CheckDeadlines 扫描所有未结束项目，按 deadline 距离决定是否发通知。
//
// 业务流程：
//  1. SELECT 候选项目（未 cancelled/archived + deadline_at 非 NULL + holder_user 非 NULL）
//  2. 对每条计算 days_until_deadline = ceil((deadline_at - now) / day)
//  3. 若 days <= 0 → 检查 overdue 去重 → 发 overdue 通知
//     若 0 < days <= 7 → 检查 deadline_approaching 去重 → 发 deadline_approaching 通知
//  4. 单条失败 log 但不返回 error（避免一条出错把整轮 cron 打挂）
//
// 设计取舍：
//   - 扫描 + 写通知 两阶段：避免持有 SELECT 游标时穿插 INSERT 引发并发问题
//   - 通知通过 NotificationService.Create 走 SECURITY DEFINER 函数；
//     调用方（cron worker）以 admin 身份操作（user_id=0 + role_id=1）
//   - dedupe 窗口固定 24h：spec §8 明确每天最多 1 次提醒，避免 push 噪音
func (c *DeadlineChecker) CheckDeadlines(ctx context.Context) error {
	now := c.now()

	// ============================================================
	// 第一步：拉取候选项目（独立事务，admin 身份绕过 RLS）
	// ============================================================
	var candidates []projectRow
	err := progressdb.InTx(ctx, c.pool, func(tx pgx.Tx) error {
		// admin 身份：role_id=1 让 is_admin() 通过
		if err := progressdb.SetSessionContext(ctx, tx, 0, 1); err != nil {
			return fmt.Errorf("deadline_check: set admin context: %w", err)
		}
		rows, err := tx.Query(ctx, `
			SELECT id, name, status::TEXT, deadline, holder_user_id
			FROM projects
			WHERE status NOT IN ('cancelled', 'archived')
			  AND deadline IS NOT NULL
			  AND holder_user_id IS NOT NULL
		`)
		if err != nil {
			return fmt.Errorf("deadline_check: query projects: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var p projectRow
			if err := rows.Scan(&p.ID, &p.Name, &p.Status, &p.DeadlineAt, &p.HolderUser); err != nil {
				return fmt.Errorf("deadline_check: scan project: %w", err)
			}
			candidates = append(candidates, p)
		}
		return rows.Err()
	})
	if err != nil {
		return err
	}

	// ============================================================
	// 第二步：对每个候选判定 + 发通知
	// ============================================================
	for _, p := range candidates {
		if p.HolderUser == nil {
			continue
		}
		days := daysUntil(p.DeadlineAt, now)
		var ntype, title, body string
		if days <= 0 {
			ntype = "overdue"
			title = "项目已超期"
			body = fmt.Sprintf("项目 %s 已超过截止日期，请尽快处理", p.Name)
		} else if days <= deadlineApproachingDays {
			ntype = "deadline_approaching"
			title = "项目即将到期"
			body = fmt.Sprintf("项目 %s 距离截止还剩 %d 天", p.Name, days)
		} else {
			continue
		}

		if err := c.maybeNotify(ctx, *p.HolderUser, ntype, p.ID, title, body, now); err != nil {
			// 单条失败 log 但继续下一条（避免一条卡死整轮）
			log.Printf("deadline_check: notify project=%d type=%s err=%v", p.ID, ntype, err)
		}
	}
	return nil
}

// maybeNotify 检查 24h 去重窗口；未发过则用 NotificationService 创建一条。
func (c *DeadlineChecker) maybeNotify(
	ctx context.Context,
	userID int64,
	ntype string,
	projectID int64,
	title, body string,
	now time.Time,
) error {
	return progressdb.InTx(ctx, c.pool, func(tx pgx.Tx) error {
		if err := progressdb.SetSessionContext(ctx, tx, 0, 1); err != nil {
			return fmt.Errorf("deadline_check: set admin context: %w", err)
		}

		// 去重：扫 notifications 表
		var hasRecent bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM notifications
				WHERE user_id = $1
				  AND type = $2::notification_type
				  AND project_id = $3
				  AND created_at > $4
			)
		`, userID, ntype, projectID, now.Add(-dedupeWindow)).Scan(&hasRecent); err != nil {
			return fmt.Errorf("deadline_check: dedupe query: %w", err)
		}
		if hasRecent {
			return nil
		}

		// Create 调 insert_notification_secure SECURITY DEFINER（已在 admin context 内允许任意 user_id）
		pid := projectID
		if _, err := c.notifSvc.Create(ctx, tx, userID, ntype, &pid, title, body); err != nil {
			return fmt.Errorf("deadline_check: create notification: %w", err)
		}
		return nil
	})
}

// daysUntil 返回从 now 到 deadline 的天数（向上取整）。
//
// 业务背景：
//   - deadline = now + 12h → 算"还剩 1 天"（差不到 24h 也要提醒）
//   - deadline 已过 → 返回 0 或负数（触发 overdue 分支）
//
// 实现：用 hours/24 + 余数判定上取整，避免 time.Duration / 时区奇异。
func daysUntil(deadline, now time.Time) int {
	diff := deadline.Sub(now)
	if diff <= 0 {
		// 已超期；返回 0 或负数都触发 overdue 分支
		return 0
	}
	hours := int(diff.Hours())
	days := hours / 24
	if hours%24 > 0 {
		days++ // 不足整天向上取整
	}
	return days
}
