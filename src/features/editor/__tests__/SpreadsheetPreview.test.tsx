/**
 * @file SpreadsheetPreview.test.tsx
 * @description xlsx → ExcelJS 迁移后渲染正确性测试
 *              验证 cell 渲染 + sanitize HTML 防注入
 * @author Atlas.oi
 * @date 2026-05-08
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import ExcelJS from 'exceljs';
import { SpreadsheetPreview } from '../SpreadsheetPreview';

/**
 * 用 ExcelJS 生成 xlsx 字节，再转成 base64 字符串
 *
 * 业务流程：
 * 1. 创建 Workbook + 添加 Worksheet
 * 2. 按行写入 cell 文本
 * 3. writeBuffer() 拿到 ArrayBuffer
 * 4. ArrayBuffer → base64（与组件内 read_image_bytes_cmd 返回格式一致）
 */
async function makeFixtureBase64(rows: string[][]): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  rows.forEach((r) => ws.addRow(r));
  const buffer = await wb.xlsx.writeBuffer();
  // ArrayBuffer → binary string → base64
  const bytes = new Uint8Array(buffer as ArrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

describe('SpreadsheetPreview (ExcelJS)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('正确渲染简单 xlsx 单元格', async () => {
    const base64 = await makeFixtureBase64([
      ['name', 'age'],
      ['alice', '30'],
      ['bob', '25'],
    ]);
    vi.mocked(invoke).mockResolvedValue(base64);

    render(<SpreadsheetPreview path="/tmp/test.xlsx" />);

    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.getByText('bob')).toBeInTheDocument();
    expect(screen.getByText('name')).toBeInTheDocument();
  });

  it('表格 cell 含恶意 HTML 时经过 escape + sanitize 不产生可触发的 img onerror', async () => {
    const base64 = await makeFixtureBase64([
      ['<img src=x onerror="alert(1)">'],
    ]);
    vi.mocked(invoke).mockResolvedValue(base64);

    const { container } = render(<SpreadsheetPreview path="/tmp/evil.xlsx" />);

    // 等待加载完成
    await waitFor(
      () => {
        expect(container.querySelector('.ghostterm-sheet')).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    // 关键安全断言：cell 文本被 escapeHtml 转义后再过 DOMPurify
    // 不能存在真实的 <img> 元素（被 escape 成 &lt;img...&gt; 文本）
    const sheet = container.querySelector('.ghostterm-sheet');
    expect(sheet).not.toBeNull();
    expect(sheet!.querySelector('img')).toBeNull();
    // 也不能有任何元素带 onerror 属性
    expect(sheet!.querySelector('[onerror]')).toBeNull();
    // 也不能有 script 元素
    expect(sheet!.querySelector('script')).toBeNull();
  });
});
