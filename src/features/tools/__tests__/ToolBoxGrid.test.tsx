/**
 * @file ToolBoxGrid.test.tsx
 * @description ToolBoxGrid 组件单元测试：验证 5 个分类卡片渲染、规则 ID 展示、运行按钮回调
 * @author Atlas.oi
 * @date 2026-04-18
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ToolBoxGrid, TOOL_BOXES } from '../ToolBoxGrid';

describe('ToolBoxGrid', () => {
  it('渲染 5 个分类卡片，每个卡片包含对应 label', () => {
    render(<ToolBoxGrid onSelectTool={vi.fn()} />);

    // 验证 5 个分类名称均出现在文档中
    expect(screen.getByText('论文格式检测')).toBeTruthy();
    expect(screen.getByText('引用格式化')).toBeTruthy();
    expect(screen.getByText('图表规范')).toBeTruthy();
    expect(screen.getByText('写作质量辅助')).toBeTruthy();
    expect(screen.getByText('去 AI 化检测')).toBeTruthy();

    // 验证恰好 5 个"运行"按钮
    const buttons = screen.getAllByText('运行');
    expect(buttons).toHaveLength(5);
  });

  it('点击运行调 onSelectTool 传入完整 toolBox 对象', async () => {
    const user = userEvent.setup();
    const onSelectTool = vi.fn();
    render(<ToolBoxGrid onSelectTool={onSelectTool} />);

    // 点击第一个卡片的"运行"按钮
    const buttons = screen.getAllByText('运行');
    await user.click(buttons[0]);

    expect(onSelectTool).toHaveBeenCalledTimes(1);
    expect(onSelectTool).toHaveBeenCalledWith(TOOL_BOXES[0]);
  });

  it('卡片包含规则 ID 列表文本（font.body 在论文格式检测卡片中）', () => {
    render(<ToolBoxGrid onSelectTool={vi.fn()} />);

    // 论文格式检测卡片的 ruleIds 应通过 join(' · ') 渲染
    const ruleText = screen.getByText(/font\.body/);
    expect(ruleText).toBeTruthy();
  });

  it('点击不同卡片的运行按钮传入对应的 toolBox', async () => {
    const user = userEvent.setup();
    const onSelectTool = vi.fn();
    render(<ToolBoxGrid onSelectTool={onSelectTool} />);

    const buttons = screen.getAllByText('运行');

    // 点击第三张卡（图表规范）
    await user.click(buttons[2]);
    expect(onSelectTool).toHaveBeenCalledWith(TOOL_BOXES[2]);
    expect(TOOL_BOXES[2].id).toBe('figure-table');
  });
});
