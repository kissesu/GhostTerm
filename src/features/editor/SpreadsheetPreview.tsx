/**
 * @file SpreadsheetPreview.tsx
 * @description Excel 表格预览组件，使用 SheetJS 将 .xlsx/.xls 渲染为 HTML 表格
 *              通过 read_image_bytes_cmd 读取文件字节，支持多工作表切换
 * @author Atlas.oi
 * @date 2026-04-16
 */

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import * as XLSX from 'xlsx';

/** 将 base64 字符串转换为 Uint8Array */
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes;
}

interface SpreadsheetPreviewProps {
  path: string;
}

/**
 * Excel 表格预览组件
 *
 * 业务逻辑：
 * 1. 通过 read_image_bytes_cmd 读取文件字节（Base64）
 * 2. SheetJS 解析工作簿，获取所有工作表名称
 * 3. 将当前选中工作表转换为 HTML 字符串，通过 dangerouslySetInnerHTML 渲染
 * 4. 提供工作表切换 Tab
 */
export function SpreadsheetPreview({ path }: SpreadsheetPreviewProps) {
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [html, setHtml] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 缓存工作簿，切换工作表时无需重新读取文件
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);

  // 初始加载：读取文件并解析工作簿
  useEffect(() => {
    setLoading(true);
    setError(null);
    setWorkbook(null);

    invoke<string>('read_image_bytes_cmd', { path })
      .then((base64) => {
        const bytes = base64ToUint8Array(base64);
        const wb = XLSX.read(bytes, { type: 'array' });
        setWorkbook(wb);
        setSheetNames(wb.SheetNames);
        const firstSheet = wb.SheetNames[0] ?? '';
        setActiveSheet(firstSheet);
        if (firstSheet) {
          setHtml(XLSX.utils.sheet_to_html(wb.Sheets[firstSheet]));
        }
        setLoading(false);
      })
      .catch((e) => {
        setLoading(false);
        setError(String(e));
      });
  }, [path]);

  // 切换工作表：从缓存工作簿重新生成 HTML，无需重新读取文件
  function switchSheet(name: string) {
    if (!workbook) return;
    setActiveSheet(name);
    setHtml(XLSX.utils.sheet_to_html(workbook.Sheets[name]));
  }

  if (error) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--c-danger)',
          fontSize: '14px',
        }}
      >
        {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--c-fg-muted)',
          fontSize: '14px',
        }}
      >
        加载中...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 工作表切换 Tab 栏（多工作表时显示） */}
      {sheetNames.length > 1 && (
        <div
          style={{
            display: 'flex',
            gap: '2px',
            padding: '4px 8px 0',
            borderBottom: '1px solid var(--c-border)',
            flexShrink: 0,
            overflowX: 'auto',
          }}
        >
          {sheetNames.map((name) => (
            <button
              key={name}
              onClick={() => switchSheet(name)}
              style={{
                padding: '4px 12px',
                fontSize: '12px',
                border: 'none',
                borderRadius: '4px 4px 0 0',
                cursor: 'pointer',
                background: name === activeSheet
                  ? 'var(--c-raised)'
                  : 'transparent',
                color: name === activeSheet
                  ? 'var(--c-fg)'
                  : 'var(--c-fg-muted)',
                whiteSpace: 'nowrap',
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* 表格内容区 */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '16px',
          minHeight: 0,
        }}
      >
        <style>{`
          .ghostterm-sheet table {
            border-collapse: collapse;
            font-size: 13px;
            font-family: 'JetBrains Mono', Menlo, monospace;
          }
          .ghostterm-sheet td, .ghostterm-sheet th {
            border: 1px solid var(--c-border);
            padding: 4px 8px;
            white-space: nowrap;
            color: var(--c-fg);
          }
          .ghostterm-sheet th {
            background: var(--c-raised);
            font-weight: 600;
          }
        `}</style>
        <div
          className="ghostterm-sheet"
          // SheetJS 生成的 HTML 为静态表格，无脚本，安全渲染
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}
