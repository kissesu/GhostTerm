/**
 * @file DocxPreview.tsx
 * @description docx-preview.js 包装组件：渲染 docx 并为每个段落注入 data-para-idx，
 *              click 事件派发 onParaClick(paraIdx)，供 RuleTemplateWorkspace 整合使用。
 *              复用 Editor 层已有的 read_image_bytes_cmd（返回 base64 字符串）。
 * @author Atlas.oi
 * @date 2026-04-18
 */

import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { renderAsync } from 'docx-preview';

/** 将 base64 字符串转换为 ArrayBuffer（与 WordPreview.tsx 保持一致） */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes.buffer;
}

interface DocxPreviewProps {
  /** docx 文件的绝对路径 */
  file: string;
  /** 点击段落时回调，参数为段落在文档中的顺序索引 */
  onParaClick?: (paraIdx: number) => void;
  /** 当前高亮字段 ID（供后续视觉提示扩展使用，当前未渲染） */
  hoveredFieldId?: string;
}

/**
 * DocxPreview 组件
 *
 * 业务逻辑：
 * 1. 通过 read_image_bytes_cmd 读取 docx 文件原始字节（Base64 编码）
 * 2. 解码为 ArrayBuffer，交给 docx-preview 渲染到容器 DOM 节点
 * 3. 渲染完成后，为所有 .docx-paragraph / p 元素注入 data-para-idx 属性
 * 4. 通过事件委托监听容器 click，找到最近的 [data-para-idx] 并触发 onParaClick
 */
export function DocxPreview({ file, onParaClick }: DocxPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;

    // 清空上一次渲染（切换 file 时重置容器）
    container.innerHTML = '';

    invoke<string>('read_image_bytes_cmd', { path: file })
      .then((base64) => {
        if (cancelled) return;
        const buffer = base64ToArrayBuffer(base64);
        if (!containerRef.current) return;
        return renderAsync(buffer, containerRef.current, undefined, {
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
        });
      })
      .then(() => {
        if (cancelled || !containerRef.current) return;
        // 注入 data-para-idx 到每个段落元素
        // docx-preview 渲染段落为 .docx-paragraph，兼容 p 标签
        const paragraphs = containerRef.current.querySelectorAll('.docx-paragraph, p');
        paragraphs.forEach((p, idx) => {
          p.setAttribute('data-para-idx', String(idx));
        });
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[DocxPreview] 渲染失败：', err);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [file]);

  // 事件委托：监听容器 click，找到最近的 [data-para-idx] 元素
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handler = (e: Event) => {
      const target = e.target as HTMLElement;
      const para = target.closest('[data-para-idx]');
      if (para) {
        const idx = parseInt(para.getAttribute('data-para-idx') ?? '-1', 10);
        if (idx >= 0 && onParaClick) onParaClick(idx);
      }
    };

    container.addEventListener('click', handler);
    return () => container.removeEventListener('click', handler);
  }, [onParaClick]);

  return (
    <div
      ref={containerRef}
      className="docx-preview-container"
      style={{
        flex: 1,
        overflow: 'auto',
        background: 'var(--c-bg)',
        padding: 20,
      }}
    />
  );
}
