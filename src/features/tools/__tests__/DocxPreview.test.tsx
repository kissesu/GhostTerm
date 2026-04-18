/**
 * @file DocxPreview.test.tsx
 * @description DocxPreview 组件测试（mock docx-preview 库 + Tauri invoke）
 * @author Atlas.oi
 * @date 2026-04-18
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { DocxPreview } from '../templates/DocxPreview';

// Mock Tauri invoke：read_image_bytes_cmd 返回 base64 字符串（与 WordPreview 保持一致）
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (_cmd: string) => {
    // 返回最短合法 base64（空字节序列），docx-preview 由 mock 拦截所以内容无关
    return btoa('');
  }),
}));

// Mock docx-preview：渲染 3 个带 docx-paragraph 类名的段落到容器
vi.mock('docx-preview', () => ({
  renderAsync: vi.fn(async (_data: unknown, container: HTMLElement) => {
    container.innerHTML = `
      <div class="docx-wrapper">
        <p class="docx-paragraph">段 0</p>
        <p class="docx-paragraph">段 1</p>
        <p class="docx-paragraph">段 2</p>
      </div>
    `;
  }),
}));

describe('DocxPreview', () => {
  // 每个 case 前清空 invoke 调用记录，防止跨 test 污染
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('点击段落触发 onParaClick 并传入正确索引', async () => {
    const onParaClick = vi.fn();
    const { container } = render(
      <DocxPreview file="/tmp/test.docx" onParaClick={onParaClick} />
    );

    // 等待 renderAsync 执行 + data-para-idx 注入完成
    await waitFor(() => {
      expect(container.querySelector('[data-para-idx="1"]')).toBeTruthy();
    });

    const p1 = container.querySelector('[data-para-idx="1"]');
    if (p1) fireEvent.click(p1);
    expect(onParaClick).toHaveBeenCalledWith(1);
  });

  it('使用 read_image_bytes_cmd 命令读取文件字节', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    render(<DocxPreview file="/path/to/doc.docx" />);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalled();
    });

    const call = (invoke as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as string).includes('bytes')
    );
    expect(call).toBeDefined();
    // 命令名含 bytes，路径参数用 path 键
    expect(call![0]).toMatch(/bytes/);
    expect(call![1]).toMatchObject({ path: '/path/to/doc.docx' });
  });

  it('为所有 docx-paragraph 注入顺序 data-para-idx', async () => {
    const { container } = render(<DocxPreview file="/tmp/multi.docx" />);

    await waitFor(() => {
      expect(container.querySelector('[data-para-idx="2"]')).toBeTruthy();
    });

    // 3 个段落的索引应为 0、1、2
    expect(container.querySelector('[data-para-idx="0"]')).toBeTruthy();
    expect(container.querySelector('[data-para-idx="1"]')).toBeTruthy();
    expect(container.querySelector('[data-para-idx="2"]')).toBeTruthy();
  });

  it('切换 file 时清空并重新渲染', async () => {
    const { container, rerender } = render(<DocxPreview file="/tmp/a.docx" />);

    await waitFor(() => {
      expect(container.querySelector('[data-para-idx="0"]')).toBeTruthy();
    });

    rerender(<DocxPreview file="/tmp/b.docx" />);

    // 重新渲染后段落仍然存在（mock 每次都填充相同内容）
    await waitFor(() => {
      expect(container.querySelector('[data-para-idx="0"]')).toBeTruthy();
    });
  });
});
