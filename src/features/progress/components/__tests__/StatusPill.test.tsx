/**
 * @file StatusPill.test.tsx
 * @description StatusPill 组件单测 - 9 status 渲染 data-status 与中文文字
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatusPill } from '../StatusPill';
import type { ProjectStatus } from '../../api/projects';
import { STATUS_LABEL } from '../../config/nbaConfig';

const ALL_STATUSES: ProjectStatus[] = [
  'dealing', 'quoting', 'developing', 'confirming', 'delivered',
  'paid', 'archived', 'after_sales', 'cancelled',
];

describe('StatusPill', () => {
  it.each(ALL_STATUSES)('status=%s 渲染正确文字 + data-status', (status) => {
    const { container } = render(<StatusPill status={status} />);
    const pill = container.querySelector('[data-status]');
    expect(pill).not.toBeNull();
    expect(pill!.getAttribute('data-status')).toBe(status);
    expect(screen.getByText(STATUS_LABEL[status])).toBeInTheDocument();
  });

  it('渲染 statusDot 圆点', () => {
    const { container } = render(<StatusPill status="developing" />);
    // statusDot class 存在于 pill 内
    expect(container.querySelector('span > span')).not.toBeNull();
  });
});
