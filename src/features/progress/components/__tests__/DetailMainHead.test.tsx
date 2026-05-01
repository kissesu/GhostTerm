/**
 * @file DetailMainHead.test.tsx
 * @description DetailMainHead 组件单测：渲染字段 / 截止颜色 class
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DetailMainHead } from '../DetailMainHead';
import type { Project } from '../../api/projects';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 1,
    name: '测试项目',
    customerLabel: '李四',
    description: '',
    priority: 'normal',
    status: 'developing',
    deadline: new Date(Date.now() + 20 * 86_400_000).toISOString(),
    dealingAt: '2026-01-01',
    originalQuote: '8000',
    currentQuote: '9000',
    afterSalesTotal: '0',
    totalReceived: '3000',
    createdBy: 1,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    thesisLevel: 'master',
    ...overrides,
  };
}

describe('DetailMainHead', () => {
  it('渲染项目名 + 客户 + 学位 + 报价 + 已收', () => {
    render(<DetailMainHead project={makeProject()} />);
    expect(screen.getByText('测试项目')).toBeInTheDocument();
    expect(screen.getByText('李四 · master')).toBeInTheDocument();
    // 报价格式：¥9,000
    expect(screen.getByText('¥9,000')).toBeInTheDocument();
    // 已收：¥3,000
    expect(screen.getByText('¥3,000')).toBeInTheDocument();
  });

  it('超期项目 → 截止日期含 deadlineHot class', () => {
    const project = makeProject({
      deadline: new Date(Date.now() - 86_400_000).toISOString(), // 昨天超期
    });
    const { container } = render(<DetailMainHead project={project} />);
    const hotEl = container.querySelector('[class*="deadlineHot"]');
    expect(hotEl).not.toBeNull();
  });

  it('thesisLevel 为空 → 显示 —', () => {
    const project = makeProject({ thesisLevel: null });
    render(<DetailMainHead project={project} />);
    expect(screen.getByText('李四 · —')).toBeInTheDocument();
  });
});
