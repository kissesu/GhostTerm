/*
@file earnings.go
@description 收益视图相关 HTTP handler 实现：
             - MeEarnings   GET /api/me/earnings  →  当前用户开发结算汇总

             实现要点：
             - service 层 EarningsSummary 聚合后 → oas.EarningsSummary 转换
             - 永远从 AuthContext 取 user_id，不接受 query/body 注入（安全：避免越权读他人收益）
             - Money 全链路 string：oas.Money 是 string 别名，用 db.Money.StringFixed(2) 输出

             语义边界（不在本 handler 做的事）：
             - 不计算"当期 vs 上期对比"：v1 后端只返回原始 totalEarned；UI 衍生指标
               （EarningsView.tsx）由前端基于 lastPaidAt 自行衍生，避免后端做"日期魔法"
             - 不返回 total_paid_in（客户付款入账）：earnings = 开发结算视图，
               与 customer_in 流向无关；total_received 是项目级字段，由 ProjectService 提供
@author Atlas.oi
@date 2026-04-29
*/

package handlers

import (
	"context"
	"errors"
	"fmt"

	"github.com/ghostterm/progress-server/internal/api/middleware"
	"github.com/ghostterm/progress-server/internal/api/oas"
	"github.com/ghostterm/progress-server/internal/services"
)

// EarningsHandler 实现 ogen 生成的 oas.Handler 中与 earnings 相关的方法。
//
// 业务背景：earnings 在 OAS 中归属 dashboard tag；本 handler 单独存在的理由：
//   - 与 PaymentHandler 共享 PaymentService，但语义不同（financial 写入 vs 收益视图读取）
//   - 未来扩展 dashboard 类指标（risks / pipeline）时容易再分文件而非塞进 PaymentHandler
type EarningsHandler struct {
	Svc services.PaymentService
}

// NewEarningsHandler 构造 EarningsHandler。
func NewEarningsHandler(svc services.PaymentService) *EarningsHandler {
	return &EarningsHandler{Svc: svc}
}

// ============================================================
// MeEarnings — GET /api/me/earnings
// ============================================================

// MeEarnings 返回当前用户的开发结算汇总。
//
// 业务流程：
//  1. 从 ctx 取 AuthContext（路由 SecurityHandler 已校验 Bearer token）
//  2. 调 svc.MyEarnings(sc) —— service 内部强制 WHERE user_id = ac.UserID
//  3. 把 services.EarningsSummary 转为 oas.EarningsSummary 返回
//
// 安全语义：
//   - 即使前端伪造请求/拦截发起 user_id 不同的查询，service 层永远从 sc.UserID 取，
//     无法通过 HTTP 参数越权读他人收益
//   - RLS view 的 security_barrier 是第二层防御；即便 service 漏校验，DB 也拦截
func (h *EarningsHandler) MeEarnings(ctx context.Context) (*oas.EarningsSummaryResponse, error) {
	sc, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		return nil, errors.New("earnings handler: missing auth context")
	}

	raw, err := h.Svc.MyEarnings(ctx, sc)
	if err != nil {
		return nil, fmt.Errorf("earnings handler: my earnings: %w", err)
	}

	summary, ok := raw.(services.EarningsSummary)
	if !ok {
		return nil, errors.New("earnings handler: unexpected earnings type from service")
	}

	return &oas.EarningsSummaryResponse{
		Data: toOASEarningsSummary(summary),
	}, nil
}

// ============================================================
// 辅助：service 层 → oas 层模型转换
// ============================================================

// toOASEarningsSummary 把 services.EarningsSummary 转为 oas.EarningsSummary。
//
// 业务要点：
//   - lastPaidAt 用 OptNilDateTime：nil → SetToNull，有值 → SetTo
//   - projects 永远返回非 nil 切片（即便用户无任何结算，前端拿到 [] 而不是 undefined，
//     避免 UI 在表格 .map 时崩）
func toOASEarningsSummary(s services.EarningsSummary) oas.EarningsSummary {
	out := oas.EarningsSummary{
		UserId:          s.UserID,
		TotalEarned:     oas.Money(s.TotalEarned.StringFixed(2)),
		SettlementCount: s.SettlementCount,
		Projects:        make([]oas.EarningsSummaryProjectsItem, 0, len(s.Projects)),
	}
	if s.LastPaidAt != nil {
		out.LastPaidAt.SetTo(*s.LastPaidAt)
	} else {
		out.LastPaidAt.SetToNull()
	}
	for _, p := range s.Projects {
		item := oas.EarningsSummaryProjectsItem{
			ProjectId:       p.ProjectID,
			ProjectName:     p.ProjectName,
			TotalEarned:     oas.Money(p.TotalEarned.StringFixed(2)),
			SettlementCount: p.SettlementCount,
		}
		if p.LastPaidAt != nil {
			item.LastPaidAt.SetTo(*p.LastPaidAt)
		} else {
			item.LastPaidAt.SetToNull()
		}
		out.Projects = append(out.Projects, item)
	}
	return out
}
