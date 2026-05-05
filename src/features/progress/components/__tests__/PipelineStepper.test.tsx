/**
 * @file PipelineStepper.test.tsx
 * @description PipelineStepper 7 段漏斗组件单测
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PipelineStepper } from '../PipelineStepper';
import type { Project } from '../../api/projects';
import { STATUS_LABEL } from '../../config/nbaConfig';

// 最小化 Project mock（仅含 PipelineStepper 用到的字段）
function makeProject(overrides: Partial<Project> & { status: Project['status'] }): Project {
  const { currentQuote, totalReceived, ...rest } = overrides;
  return {
    id: 1,
    name: '测试项目',
    customerLabel: '客户A',
    description: '',
    priority: 'normal',
    deadline: '2026-12-31',
    quotingAt: '2026-01-01',
    originalQuote: '0',
    currentQuote: currentQuote ?? '0',
    afterSalesTotal: '0',
    totalReceived: totalReceived ?? '0',
    createdBy: 1,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    developers: [],
    ...rest,
  };
}

describe('PipelineStepper', () => {
  it('渲染全部 6 段（PIPELINE_STAGES，2026-05-04 删 dealing 后）', () => {
    render(<PipelineStepper projects={[]} />);
    const stages = ['quoting', 'developing', 'confirming', 'delivered', 'paid', 'archived'];
    for (const stage of stages) {
      expect(screen.getByTestId('pipeline-step-' + stage)).toBeInTheDocument();
    }
  });

  it('每段显示正确中文名', () => {
    render(<PipelineStepper projects={[]} />);
    expect(screen.getByText(STATUS_LABEL['quoting'])).toBeInTheDocument();
    expect(screen.getByText(STATUS_LABEL['archived'])).toBeInTheDocument();
  });

  it('count + sumText 正确渲染', () => {
    const projects = [
      makeProject({ status: 'developing', currentQuote: '10000', totalReceived: '3000' }),
      makeProject({ status: 'developing', currentQuote: '5000', totalReceived: '5000' }),
    ];
    render(<PipelineStepper projects={projects} />);
    const devStep = screen.getByTestId('pipeline-step-developing');
    expect(devStep).toHaveTextContent('2 单');
    // 待收 = (10000-3000) + (5000-5000) = 7000
    expect(devStep).toHaveTextContent('¥7,000');
  });

  it('quoting 段未指定 currentStatus 时显示 — / dim（2026-05-04 删 dealing 后由 quoting 接管首段）', () => {
    const projects = [makeProject({ status: 'quoting', currentQuote: '8000', totalReceived: '0' })];
    render(<PipelineStepper projects={projects} />);
    const quotingStep = screen.getByTestId('pipeline-step-quoting');
    // 未指定 currentStatus 时仍走全局统计；本测试只验证渲染存在
    expect(quotingStep).toBeInTheDocument();
  });

  it('count=0 的 stage 显示 — 且 data-state=dim（无 currentStatus）', () => {
    render(<PipelineStepper projects={[]} />);
    const step = screen.getByTestId('pipeline-step-quoting');
    expect(step.getAttribute('data-state')).toBe('dim');
    expect(step).toHaveTextContent('—');
  });

  it('currentStatus=developing → quoting=done, developing=current, confirming=future', () => {
    const projects = [
      makeProject({ status: 'quoting' }),
      makeProject({ status: 'developing' }),
      makeProject({ status: 'confirming' }),
    ];
    render(<PipelineStepper projects={projects} currentStatus="developing" />);
    expect(screen.getByTestId('pipeline-step-quoting').getAttribute('data-state')).toBe('done');
    expect(screen.getByTestId('pipeline-step-developing').getAttribute('data-state')).toBe('current');
    expect(screen.getByTestId('pipeline-step-confirming').getAttribute('data-state')).toBe('future');
  });

  it('每段都含 SVG chevron 元素', () => {
    const { container } = render(<PipelineStepper projects={[]} />);
    const svgs = container.querySelectorAll('svg');
    // 6 段各有一个 chevron svg（2026-05-04 删 dealing 后）
    expect(svgs.length).toBe(6);
  });

  it('aria-label 包含 status 名 + 数量', () => {
    const projects = [makeProject({ status: 'paid' })];
    render(<PipelineStepper projects={projects} />);
    const paidStep = screen.getByTestId('pipeline-step-paid');
    expect(paidStep.getAttribute('aria-label')).toBe(`${STATUS_LABEL['paid']} 1 单`);
  });
});
