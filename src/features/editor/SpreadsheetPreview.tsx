/**
 * @file SpreadsheetPreview.tsx
 * @description Excel 表格预览组件，使用 ExcelJS 将 .xlsx/.xlsm 渲染为 HTML 表格
 *              通过 read_image_bytes_cmd 读取文件字节，支持多工作表切换
 *
 *              安全说明（PR-1 finding #3）：
 *              原使用 xlsx@0.18.5 (SheetJS CE)，存在 GHSA-4r6h-8v6p-xvw6 (Prototype Pollution)
 *              和 CVE-2024-22363 (ReDoS)，且包已脱离 npm 维护永无补丁。迁移到 ExcelJS。
 *
 *              三层 XSS 防御：
 *              1. cell.text 拿"已求值"文本（不解析单元格内的标签）
 *              2. escapeHtml 转义原始字符（&<>"'）
 *              3. sanitizeUserHtml (DOMPurify) 兜底过滤
 *
 * @author Atlas.oi
 * @date 2026-05-08
 */

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import ExcelJS from 'exceljs';
import { sanitizeUserHtml } from '../../shared/lib/sanitize';

/** 将 base64 字符串转换为 Uint8Array */
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes;
}

/** HTML 转义，防止 cell 内的 < > & " ' 直接写进 innerHTML 触发标签解析 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 安全 review M3：ExcelJS 渲染上限防 zip-bomb / max-row DoS
//
// 攻击场景：
//   - .xlsx 真实大小 1MB（高压缩 SharedStrings.xml）解压后 1GB → webview 渲染 OOM 崩溃
//   - cell 范围 A1:ZZZ1000000 → 数百万 row 遍历占内存爆栈
//   - 用户每次打开攻击者植入的 .xlsx 都崩 → 项目文件树 preview 受阻
//
// 上限选择：
//   - MAX_RENDER_ROWS=10000：5 人内部 Excel 通常 < 1000 行；10K 给余量足够
//   - MAX_RENDER_CELLS_PER_ROW=200：限单行宽度防 ZZZ... 列范围
//   - 超限直接截断渲染 + 显示警告（不抛错让 UI 仍可见前 10K 行）
const MAX_RENDER_ROWS = 10000;
const MAX_RENDER_CELLS_PER_ROW = 200;

/**
 * 把 ExcelJS Worksheet 渲染成 HTML table 字符串
 *
 * 业务流程：
 * 1. 遍历 worksheet.eachRow 收集所有行（包含空 cell 以保表格结构）
 * 2. 每个 cell 取 .text 属性（ExcelJS 默认对 formula 求值，返回字符串）
 * 3. 对 cell 文本做 escapeHtml（防原始字符注入）
 * 4. 拼成 <table><tr><td>...</td></tr></table>
 * 5. 调用方需用 sanitizeUserHtml 再过一遍（双层防御）
 *
 * 安全 review M3：超过 MAX_RENDER_ROWS 行 / MAX_RENDER_CELLS_PER_ROW 列后截断；
 * 在尾部追加截断提示 row 让用户感知，不抛错让 UI 仍可见前 N 行内容。
 */
function worksheetToHtml(ws: ExcelJS.Worksheet): string {
  const rows: string[] = [];
  let rowCount = 0;
  let truncated = false;

  ws.eachRow({ includeEmpty: false }, (row) => {
    if (rowCount >= MAX_RENDER_ROWS) {
      truncated = true;
      return;
    }
    const cells: string[] = [];
    let cellCount = 0;
    row.eachCell({ includeEmpty: true }, (cell) => {
      if (cellCount >= MAX_RENDER_CELLS_PER_ROW) {
        return;
      }
      // cell.text: ExcelJS 内部 formula 求值后的字符串展示
      // null/undefined 兜底空串
      const text = cell.text ?? '';
      cells.push(`<td>${escapeHtml(String(text))}</td>`);
      cellCount++;
    });
    rows.push(`<tr>${cells.join('')}</tr>`);
    rowCount++;
  });

  if (truncated) {
    rows.push(
      `<tr><td colspan="${MAX_RENDER_CELLS_PER_ROW}" style="background:#fff3cd;color:#856404;padding:8px;font-style:italic">已截断显示前 ${MAX_RENDER_ROWS} 行（防 webview OOM）</td></tr>`
    );
  }
  return `<table>${rows.join('')}</table>`;
}

interface SpreadsheetPreviewProps {
  path: string;
}

/**
 * Excel 表格预览组件
 *
 * 业务逻辑：
 * 1. 通过 read_image_bytes_cmd 读取文件字节（Base64）
 * 2. ExcelJS 解析工作簿，获取所有工作表名称
 * 3. 将当前选中工作表转换为 HTML 字符串，过 sanitize 后通过 dangerouslySetInnerHTML 渲染
 * 4. 提供工作表切换 Tab
 */
export function SpreadsheetPreview({ path }: SpreadsheetPreviewProps) {
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [html, setHtml] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 缓存工作簿，切换工作表时无需重新读取文件
  const [workbook, setWorkbook] = useState<ExcelJS.Workbook | null>(null);

  // 初始加载：读取文件并解析工作簿
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setWorkbook(null);

    invoke<string>('read_image_bytes_cmd', { path })
      .then(async (base64) => {
        const bytes = base64ToUint8Array(base64);
        // ExcelJS 需要 ArrayBuffer，Uint8Array.buffer 直接拿
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(bytes.buffer as ArrayBuffer);

        if (cancelled) return;

        // 收集所有 worksheet 名称（ExcelJS 用 wb.worksheets 数组）
        const names = wb.worksheets.map((ws) => ws.name);
        setWorkbook(wb);
        setSheetNames(names);
        const firstSheet = names[0] ?? '';
        setActiveSheet(firstSheet);
        if (firstSheet) {
          const ws = wb.getWorksheet(firstSheet);
          if (ws) {
            setHtml(worksheetToHtml(ws));
          }
        }
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoading(false);
        setError(String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  // 切换工作表：从缓存工作簿重新生成 HTML，无需重新读取文件
  function switchSheet(name: string) {
    if (!workbook) return;
    const ws = workbook.getWorksheet(name);
    if (!ws) return;
    setActiveSheet(name);
    setHtml(worksheetToHtml(ws));
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
          // ExcelJS 输出的 HTML 已 escapeHtml 过 cell 文本，再过 DOMPurify 防 XSS
          // 与 CSP script-src 'self' 三层防御：CSP 拦 inline script，DOMPurify 拦 attribute trigger，escapeHtml 拦原始标签
          dangerouslySetInnerHTML={{ __html: sanitizeUserHtml(html) }}
        />
      </div>
    </div>
  );
}
