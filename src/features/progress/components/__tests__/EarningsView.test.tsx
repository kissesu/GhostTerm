/**
 * @file EarningsView.test.tsx
 * @description EarningsView 单测：loading 状态 / 渲染 summary cards / 项目明细
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EarningsView } from '../EarningsView';
import type { EarningsSummary } from '../../api/earnings';

const mockLoad = vi.fn();

const mockSummary: EarningsSummary = {
  userId: 1,
  totalEarned: '12345',
  settlementCount: 3,
  projects: [
    {
      projectId: 1,
      projectName: '收益项目A',
      totalEarned: '5000',
      settlementCount: 2,
      lastPaidAt: '2026-04-01T00:00:00Z',
    },
  ],
};

let currentSummary: EarningsSummary | null = null;
let currentError: string | null = null;

vi.mock('../../stores/earningsStore', () => ({
  useEarningsStore: (selector: (s: object) => unknown) =>
    selector({ summary: currentSummary, load: mockLoad, error: currentError }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  currentSummary = null;
  currentError = null;
});

describe('EarningsView', () => {
  it('summary=null → 显示"正在加载…"', () => {
    render(<EarningsView />);
    expect(screen.getByText('正在加载…')).toBeInTheDocument();
  });

  it('渲染 summary cards', () => {
    currentSummary = mockSummary;
    render(<EarningsView />);
    // 累计结算金额
    expect(screen.getByText('¥12,345')).toBeInTheDocument();
    // 结算笔数
    expect(screen.getByText('3')).toBeInTheDocument();
    // 参与项目数
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('渲染项目明细列表', () => {
    currentSummary = mockSummary;
    render(<EarningsView />);
    expect(screen.getByText('收益项目A')).toBeInTheDocument();
    expect(screen.getByText('¥5,000')).toBeInTheDocument();
  });

  it('error → 显示错误文案', () => {
    currentError = '网络错误';
    render(<EarningsView />);
    expect(screen.getByText(/加载收益数据失败/)).toBeInTheDocument();
  });

  it('mount 后调用 load', () => {
    render(<EarningsView />);
    expect(mockLoad).toHaveBeenCalledOnce();
  });
});
