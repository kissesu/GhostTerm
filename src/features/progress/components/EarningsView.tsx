/**
 * @file EarningsView.tsx
 * @description 收益概览视图 - summary cards + 项目明细列表
 *              设计稿无 mockup，按 §1.4 简洁布局
 *              字段按实际 API schema（EarningsSummary.totalEarned / settlementCount / projects）
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { useEffect, type ReactElement } from 'react';
import { useEarningsStore } from '../stores/earningsStore';

export function EarningsView(): ReactElement {
  const summary = useEarningsStore((s) => s.summary);
  const load = useEarningsStore((s) => s.load);
  const error = useEarningsStore((s) => s.error);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return <p style={{ padding: 16, color: 'var(--red)' }}>加载收益数据失败：{error}</p>;
  }

  if (!summary) {
    return <p style={{ padding: 16, color: 'var(--muted)' }}>正在加载…</p>;
  }

  return (
    <div>
      {/* 3 个汇总卡片 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <div
          style={{
            border: '1px solid var(--line)',
            borderRadius: 10,
            padding: 16,
            background: 'var(--panel)',
          }}
        >
          <div style={{ color: 'var(--muted)', fontSize: 11 }}>累计结算</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 8 }}>
            ¥{Number(summary.totalEarned ?? 0).toLocaleString()}
          </div>
        </div>
        <div
          style={{
            border: '1px solid var(--line)',
            borderRadius: 10,
            padding: 16,
            background: 'var(--panel)',
          }}
        >
          <div style={{ color: 'var(--muted)', fontSize: 11 }}>结算笔数</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 8 }}>
            {summary.settlementCount}
          </div>
        </div>
        <div
          style={{
            border: '1px solid var(--line)',
            borderRadius: 10,
            padding: 16,
            background: 'var(--panel)',
          }}
        >
          <div style={{ color: 'var(--muted)', fontSize: 11 }}>参与项目数</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 8 }}>
            {summary.projects.length}
          </div>
        </div>
      </div>

      {/* 项目明细列表 */}
      {summary.projects.length > 0 && (
        <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: 'var(--panel-2)', color: 'var(--muted)' }}>
              <tr>
                <th style={{ padding: 12, textAlign: 'left' }}>项目</th>
                <th style={{ padding: 12, textAlign: 'right' }}>已结算</th>
                <th style={{ padding: 12, textAlign: 'right' }}>笔数</th>
                <th style={{ padding: 12, textAlign: 'right' }}>最后结算</th>
              </tr>
            </thead>
            <tbody>
              {summary.projects.map((p) => (
                <tr key={p.projectId} style={{ borderTop: '1px solid var(--line)' }}>
                  <td style={{ padding: 12 }}>{p.projectName}</td>
                  <td style={{ padding: 12, textAlign: 'right' }}>
                    ¥{Number(p.totalEarned ?? 0).toLocaleString()}
                  </td>
                  <td style={{ padding: 12, textAlign: 'right' }}>{p.settlementCount}</td>
                  <td style={{ padding: 12, textAlign: 'right', color: 'var(--muted)' }}>
                    {p.lastPaidAt ? new Date(p.lastPaidAt).toLocaleDateString('zh-CN') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
