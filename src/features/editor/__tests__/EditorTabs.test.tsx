/**
 * @file EditorTabs 组件测试
 * @description 测试标签栏：文件列表渲染、点击切换 active、关闭按钮、dirty 标记
 * @author Atlas.oi
 * @date 2026-04-13
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useEditorStore } from '../editorStore';
import EditorTabs from '../tabs/EditorTabs';
import type { OpenFile } from '../../../shared/types';

/** 创建测试用 OpenFile */
function makeFile(path: string, overrides: Partial<OpenFile> = {}): OpenFile {
  return {
    path,
    content: '',
    diskContent: '',
    isDirty: false,
    language: 'ts',
    kind: 'text',
    ...overrides,
  };
}

describe('EditorTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.setState({
      openFiles: [],
      activeFilePath: null,
    });
  });

  it('无打开文件时不渲染任何标签', () => {
    render(<EditorTabs />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('渲染打开文件列表，显示文件名（非完整路径）', () => {
    useEditorStore.setState({
      openFiles: [
        makeFile('/src/main.ts'),
        makeFile('/src/App.tsx'),
      ],
      activeFilePath: '/src/main.ts',
    });

    render(<EditorTabs />);
    // 应显示文件名而非完整路径
    expect(screen.getByText('main.ts')).toBeInTheDocument();
    expect(screen.getByText('App.tsx')).toBeInTheDocument();
  });

  it('active 文件标签有激活样式（data-active 属性）', () => {
    useEditorStore.setState({
      openFiles: [makeFile('/src/a.ts'), makeFile('/src/b.ts')],
      activeFilePath: '/src/a.ts',
    });

    render(<EditorTabs />);
    const tabs = screen.getAllByRole('tab');
    // 找到 a.ts 标签
    const activeTab = tabs.find((t) => t.textContent?.includes('a.ts'));
    expect(activeTab).toBeDefined();
    expect(activeTab?.getAttribute('data-active')).toBe('true');
  });

  it('点击标签切换 activeFilePath', () => {
    const setActiveMock = vi.fn();
    useEditorStore.setState({
      openFiles: [makeFile('/src/a.ts'), makeFile('/src/b.ts')],
      activeFilePath: '/src/a.ts',
      setActive: setActiveMock,
    } as any);

    render(<EditorTabs />);
    const tabs = screen.getAllByRole('tab');
    const bTab = tabs.find((t) => t.textContent?.includes('b.ts'));
    fireEvent.click(bTab!);

    expect(setActiveMock).toHaveBeenCalledWith('/src/b.ts');
  });

  it('关闭按钮调用 closeFile', () => {
    const closeFileMock = vi.fn();
    useEditorStore.setState({
      openFiles: [makeFile('/src/a.ts')],
      activeFilePath: '/src/a.ts',
      closeFile: closeFileMock,
    } as any);

    render(<EditorTabs />);
    const closeBtn = screen.getByRole('button', { name: /关闭/ });
    fireEvent.click(closeBtn);

    expect(closeFileMock).toHaveBeenCalledWith('/src/a.ts');
  });

  it('点击关闭按钮不同时触发 setActive', () => {
    const setActiveMock = vi.fn();
    const closeFileMock = vi.fn();
    useEditorStore.setState({
      openFiles: [makeFile('/src/a.ts')],
      activeFilePath: '/src/a.ts',
      setActive: setActiveMock,
      closeFile: closeFileMock,
    } as any);

    render(<EditorTabs />);
    const closeBtn = screen.getByRole('button', { name: /关闭/ });
    fireEvent.click(closeBtn);

    // 关闭按钮应阻止事件冒泡，不触发 setActive
    expect(closeFileMock).toHaveBeenCalledTimes(1);
    expect(setActiveMock).not.toHaveBeenCalled();
  });

  it('dirty 文件显示脏标记（小圆点）', () => {
    useEditorStore.setState({
      openFiles: [makeFile('/src/a.ts', { isDirty: true })],
      activeFilePath: '/src/a.ts',
    });

    render(<EditorTabs />);
    // dirty 文件应显示脏标记
    expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
  });

  it('clean 文件不显示脏标记', () => {
    useEditorStore.setState({
      openFiles: [makeFile('/src/a.ts', { isDirty: false })],
      activeFilePath: '/src/a.ts',
    });

    render(<EditorTabs />);
    expect(screen.queryByTestId('dirty-indicator')).not.toBeInTheDocument();
  });
});
