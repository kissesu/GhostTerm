/**
 * @file EarningsView.tsx
 * @description 当前用户开发结算汇总视图（Phase 9 Worker F）。
 *
 *              业务定位：
 *                - 在 dashboard 顶部展示"我累计已结算"金额
 *                - 下方列出 per-project 明细（项目名 / 累计金额 / 次数 / 最后结算时间）
 *
 *              衍生 UI 标记（与任务说明对齐）：
 *                - 顶部金额用大字号 + ¥ 前缀
 *                - lastPaidAt 用相对时间（"3 天前"）便于浏览
 *                - 没有 lastPaidAt 的用户显示 "—"，避免 null 崩 UI
 *
 *              数据流：
 *                - 挂载时调 store.refetch()
 *                - PaymentDialog 提交 dev_settlement 后会 refetchEarnings()，
 *                  本组件下次渲染自动反映新数字
 *
 *              Money 显示规范：
 *                - 后端给的 totalEarned 是 string "9124.69"
 *                - 前端展示直接 ¥ + 字符串拼接，不做 parseFloat 避免精度丢失
 *                - 中文千分位：用 Intl.NumberFormat('zh-CN') 但仅处理整数部分，
 *                  小数部分保持 ".69" 不变（避免格式化把 .69 改成 .7）
 *
 *              不做：
 *                - 不做"当期 vs 上期"对比折线：v1 后端不返回时间序列
 *                - 不做空数据 illustration：v1 简洁文字提示即可
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { useEffect } from 'react';
import { TrendingUp, Wallet, Coins } from 'lucide-react';

import { useEarningsStore } from '../stores/earningsStore';

/**
 * 把 Money string（"9124.69"）格式化为 ¥9,124.69（中文千分位）。
 *
 * 业务背景：避免 parseFloat 损失精度，分别处理整数 + 小数部分：
 *   - 整数部分用 Intl.NumberFormat 加千分位
 *   - 小数部分原样保留（始终 2 位）
 *   - 负数前缀保留 "-"
 */
function formatMoney(s: string): string {
  if (!s) return '¥0.00';
  const isNegative = s.startsWith('-');
  const abs = isNegative ? s.slice(1) : s;
  const dotIdx = abs.indexOf('.');
  const intPart = dotIdx >= 0 ? abs.slice(0, dotIdx) : abs;
  const fracPart = dotIdx >= 0 ? abs.slice(dotIdx) : '.00';
  // Intl 处理千分位
  const intNum = Number.parseInt(intPart, 10);
  const intFormatted = Number.isFinite(intNum)
    ? new Intl.NumberFormat('zh-CN').format(intNum)
    : intPart;
  return `${isNegative ? '-' : ''}¥${intFormatted}${fracPart}`;
}

/**
 * 把 ISO datetime 渲染为本地友好时间。
 *
 * v1 简化：直接 toLocaleDateString('zh-CN')；后续可加"3 天前"相对时间。
 */
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('zh-CN');
  } catch {
    return iso;
  }
}

export default function EarningsView() {
  const summary = useEarningsStore((s) => s.summary);
  const loading = useEarningsStore((s) => s.loading);
  const error = useEarningsStore((s) => s.error);
  const refetch = useEarningsStore((s) => s.refetch);

  // 挂载时拉取
  useEffect(() => {
    refetch().catch(() => {
      // 错误已写入 store.error；UI 渲染处理
    });
  }, [refetch]);

  return (
    <div
      data-testid="earnings-view"
      style={{
        padding: 20,
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Wallet size={18} aria-hidden="true" style={{ color: 'var(--accent)' }} />
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--text)', letterSpacing: 0.2 }}>
          我的收益（仅自己可见）
        </h3>
      </header>

      {/* 累计金额（大字号） */}
      <div
        data-testid="earnings-total"
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
        }}
      >
        <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)', letterSpacing: 0.3 }}>
          {summary ? formatMoney(summary.totalEarned) : '¥—'}
        </span>
        <span style={{ fontSize: 11, color: 'var(--faint)', fontWeight: 500 }}>累计已结算</span>
      </div>

      {/* 概要指标行 */}
      <div style={{ display: 'flex', gap: 20, fontSize: 12, color: 'var(--muted)' }}>
        <span data-testid="earnings-count" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Coins size={12} aria-hidden="true" />
          {summary ? `${summary.settlementCount} 笔` : '—'}
        </span>
        <span data-testid="earnings-last-paid" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <TrendingUp size={12} aria-hidden="true" />
          上次：{summary ? formatDateTime(summary.lastPaidAt) : '—'}
        </span>
      </div>

      {/* 错误 / 加载提示 */}
      {error && (
        <div
          data-testid="earnings-error"
          style={{
            padding: '8px 12px',
            border: '1px solid rgba(239, 104, 98, 0.4)',
            borderRadius: 6,
            background: 'rgba(239, 104, 98, 0.1)',
            color: '#ffd8d4',
            fontSize: 12,
          }}
        >
          加载失败：{error}
        </div>
      )}
      {loading && !summary && (
        <div data-testid="earnings-loading" style={{ fontSize: 12, color: 'var(--faint)' }}>
          加载中…
        </div>
      )}

      {/* per-project 明细表 */}
      {summary && summary.projects.length > 0 && (
        <table
          data-testid="earnings-table"
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 12,
          }}
        >
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--line-strong)' }}>
              <th style={thStyle}>项目</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>累计金额</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>笔数</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>最近一次</th>
            </tr>
          </thead>
          <tbody>
            {summary.projects.map((p) => (
              <tr
                key={p.projectId}
                data-testid={`earnings-row-${p.projectId}`}
                style={{ borderBottom: '1px solid var(--line)' }}
              >
                <td style={tdStyle}>{p.projectName}</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {formatMoney(p.totalEarned)}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{p.settlementCount}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{formatDateTime(p.lastPaidAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {summary && summary.projects.length === 0 && !loading && (
        <div data-testid="earnings-empty" style={{ fontSize: 12, color: 'var(--faint)' }}>
          暂无结算记录
        </div>
      )}
    </div>
  );
}

// ============================================
// 内联样式（habitat tokens）
// ============================================

const thStyle: React.CSSProperties = {
  padding: '8px 6px',
  fontWeight: 800,
  fontSize: 11,
  color: 'var(--faint)',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const tdStyle: React.CSSProperties = {
  padding: '8px 6px',
  color: 'var(--text)',
};
