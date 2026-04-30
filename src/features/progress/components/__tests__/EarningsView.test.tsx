/**
 * @file EarningsView.test.tsx
 * @description Phase 9 Worker F EarningsView 组件测试。
 *
 *              覆盖：
 *              - 挂载时调 getMyEarnings + 渲染 totalEarned/settlementCount
 *              - Money 千分位格式化（"9124.69" → "¥9,124.69"；"1000000.50" → "¥1,000,000.50"）
 *              - per-project 表格渲染
 *              - 空数据：projects=[] 时显示空提示
 *              - 加载错误：显示 error 区
 *              - 加载中：summary=null + loading=true 显示 loading 提示
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ============================================
// mock api/earnings：拦截 getMyEarnings
// ============================================
vi.mock('../../api/earnings', async () => {
  const actual = await vi.importActual<typeof import('../../api/earnings')>('../../api/earnings');
  return {
    ...actual,
    getMyEarnings: vi.fn(),
  };
});

import { getMyEarnings, type EarningsSummary } from '../../api/earnings';
import { useEarningsStore } from '../../stores/earningsStore';
import EarningsView from '../EarningsView';

const mockedGet = vi.mocked(getMyEarnings);

const sampleSummary = (overrides: Partial<EarningsSummary> = {}): EarningsSummary => ({
  userId: 7,
  totalEarned: '9124.69',
  settlementCount: 3,
  lastPaidAt: '2026-04-29T10:00:00Z',
  projects: [
    {
      projectId: 100,
      projectName: 'TestProject A',
      totalEarned: '5000.00',
      settlementCount: 2,
      lastPaidAt: '2026-04-29T10:00:00Z',
    },
    {
      projectId: 101,
      projectName: 'TestProject B',
      totalEarned: '4124.69',
      settlementCount: 1,
      lastPaidAt: '2026-04-28T10:00:00Z',
    },
  ],
  ...overrides,
});

beforeEach(() => {
  mockedGet.mockReset();
  useEarningsStore.getState().clear();
});

// ============================================================
// 加载 + 渲染
// ============================================================

describe('EarningsView - 加载 + 渲染', () => {
  it('挂载时调用 getMyEarnings 并渲染累计金额', async () => {
    mockedGet.mockResolvedValueOnce(sampleSummary());

    render(<EarningsView />);

    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.getByTestId('earnings-total')).toHaveTextContent('¥9,124.69');
    });
    expect(screen.getByTestId('earnings-count')).toHaveTextContent('3 笔');
  });

  it('渲染 per-project 明细表', async () => {
    mockedGet.mockResolvedValueOnce(sampleSummary());

    render(<EarningsView />);

    await waitFor(() => expect(screen.getByTestId('earnings-table')).toBeInTheDocument());

    expect(screen.getByTestId('earnings-row-100')).toHaveTextContent('TestProject A');
    expect(screen.getByTestId('earnings-row-100')).toHaveTextContent('¥5,000.00');
    expect(screen.getByTestId('earnings-row-100')).toHaveTextContent('2');

    expect(screen.getByTestId('earnings-row-101')).toHaveTextContent('TestProject B');
    expect(screen.getByTestId('earnings-row-101')).toHaveTextContent('¥4,124.69');
    expect(screen.getByTestId('earnings-row-101')).toHaveTextContent('1');
  });
});

// ============================================================
// Money 千分位格式化
// ============================================================

describe('EarningsView - Money 千分位格式化', () => {
  it('百万级金额格式化正确：1000000.50 → ¥1,000,000.50', async () => {
    mockedGet.mockResolvedValueOnce(
      sampleSummary({
        totalEarned: '1000000.50',
        projects: [
          {
            projectId: 1,
            projectName: 'Big',
            totalEarned: '1000000.50',
            settlementCount: 1,
            lastPaidAt: null,
          },
        ],
      }),
    );

    render(<EarningsView />);

    await waitFor(() => {
      expect(screen.getByTestId('earnings-total')).toHaveTextContent('¥1,000,000.50');
    });
    expect(screen.getByTestId('earnings-row-1')).toHaveTextContent('¥1,000,000.50');
  });

  it('小数 0.01 渲染保留两位（不被四舍五入）', async () => {
    mockedGet.mockResolvedValueOnce(
      sampleSummary({
        totalEarned: '0.01',
        projects: [
          {
            projectId: 1,
            projectName: 'Tiny',
            totalEarned: '0.01',
            settlementCount: 1,
            lastPaidAt: null,
          },
        ],
      }),
    );

    render(<EarningsView />);

    await waitFor(() => {
      expect(screen.getByTestId('earnings-total')).toHaveTextContent('¥0.01');
    });
  });
});

// ============================================================
// 空数据
// ============================================================

describe('EarningsView - 空数据', () => {
  it('projects=[] 时显示空提示，不渲染表格', async () => {
    mockedGet.mockResolvedValueOnce(
      sampleSummary({
        totalEarned: '0.00',
        settlementCount: 0,
        projects: [],
        lastPaidAt: null,
      }),
    );

    render(<EarningsView />);

    await waitFor(() => expect(screen.getByTestId('earnings-empty')).toBeInTheDocument());
    expect(screen.queryByTestId('earnings-table')).toBeNull();
  });

  it('lastPaidAt = null 时显示 "—"', async () => {
    mockedGet.mockResolvedValueOnce(
      sampleSummary({
        lastPaidAt: null,
        projects: [],
      }),
    );

    render(<EarningsView />);

    await waitFor(() => {
      expect(screen.getByTestId('earnings-last-paid')).toHaveTextContent('—');
    });
  });
});

// ============================================================
// 加载状态 / 错误
// ============================================================

describe('EarningsView - 加载 + 错误状态', () => {
  it('getMyEarnings 失败 → 显示 error 区', async () => {
    mockedGet.mockRejectedValueOnce(new Error('network down'));

    render(<EarningsView />);

    await waitFor(() => expect(screen.getByTestId('earnings-error')).toBeInTheDocument());
    expect(screen.getByTestId('earnings-error')).toHaveTextContent(/network down/);
  });
});
