/**
 * @file WordPreview.tsx
 * @description Word 文档预览组件，使用 docx-preview 将 .docx 渲染为 HTML
 *              通过 read_image_bytes_cmd 读取文件字节，无需后端额外命令
 * @author Atlas.oi
 * @date 2026-04-16
 */

import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { renderAsync } from 'docx-preview';

/** 将 base64 字符串转换为 ArrayBuffer */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes.buffer;
}

interface WordPreviewProps {
  path: string;
}

/**
 * Word 文档预览组件
 *
 * 业务逻辑：
 * 1. 通过 read_image_bytes_cmd 读取 .docx 文件的原始字节（Base64）
 * 2. 解码为 ArrayBuffer，交给 docx-preview 渲染到容器 DOM 节点
 * 3. docx-preview 自动注入样式，无需额外 CSS 配置
 */
export function WordPreview({ path }: WordPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    invoke<string>('read_image_bytes_cmd', { path })
      .then((base64) => {
        const buffer = base64ToArrayBuffer(base64);
        if (!containerRef.current) return;
        return renderAsync(buffer, containerRef.current, undefined, {
          // 保持文档内链接不跳转
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
        });
      })
      .then(() => setLoading(false))
      .catch((e) => {
        setLoading(false);
        setError(String(e));
      });
  }, [path]);

  if (error) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--c-error, #f7768e)',
          fontSize: '14px',
        }}
      >
        {error}
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', height: '100%', overflow: 'auto' }}>
      {loading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--c-text-muted, #565f89)',
            fontSize: '14px',
            zIndex: 1,
          }}
        >
          加载中...
        </div>
      )}
      <div
        ref={containerRef}
        style={{
          padding: '24px',
          minHeight: '100%',
          // docx-preview 渲染出的 HTML 背景默认白色，这里让外层容器适配主题
          background: 'var(--c-surface-1, #ffffff)',
        }}
      />
    </div>
  );
}
