/**
 * @file PipelineStepper.test.tsx
 * @description 7 段漏斗组件渲染 + 高亮逻辑
 * @author Atlas.oi
 * @date 2026-04-30
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PipelineStepper } from '../PipelineStepper';
import type { Project } from '../../api/projects';

// 注意：Project 字段使用 currentQuote/totalReceived，而非 quote/paid
// pending = currentQuote - totalReceived
const mockProjects: Project[] = [
  { id: 1, status: 'developing', currentQuote: '8000', totalReceived: '3000' } as Project,
  { id: 2, status: 'developing', currentQuote: '6000', totalReceived: '0' } as Project,
  { id: 3, status: 'quoting', currentQuote: '5000', totalReceived: '0' } as Project,
];

describe('PipelineStepper', () => {
  it('渲染 7 段：dealing/quoting/developing/confirming/delivered/paid/archived', () => {
    render(<PipelineStepper projects={mockProjects} />);
    ['洽谈', '报价', '开发中', '验收', '已交付', '已收款', '已归档'].forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });

  it('每段显示项目数 + 待收金额累计', () => {
    render(<PipelineStepper projects={mockProjects} />);
    // developing 2 单
    const developing = screen.getByTestId('pipeline-step-developing');
    expect(developing).toHaveTextContent('2 单');
    // 累计待收 = (8000-3000) + (6000-0) = 11000
    expect(developing).toHaveTextContent('¥11,000');
  });

  it('currentStatus="developing" 时该段标 current', () => {
    render(<PipelineStepper projects={mockProjects} currentStatus="developing" />);
    const developing = screen.getByTestId('pipeline-step-developing');
    expect(developing).toHaveAttribute('data-state', 'current');
  });

  it('currentStatus="developing" 时之前段标 done，之后段标 future', () => {
    render(<PipelineStepper projects={mockProjects} currentStatus="developing" />);
    expect(screen.getByTestId('pipeline-step-quoting')).toHaveAttribute('data-state', 'done');
    expect(screen.getByTestId('pipeline-step-confirming')).toHaveAttribute('data-state', 'future');
  });

  it('currentStatus 缺省 + 段空 → 标 dim', () => {
    render(<PipelineStepper projects={mockProjects} />);
    expect(screen.getByTestId('pipeline-step-paid')).toHaveAttribute('data-state', 'dim');
  });
});
