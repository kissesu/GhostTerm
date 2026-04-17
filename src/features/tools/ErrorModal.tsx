/**
 * @file ErrorModal.tsx
 * @description sidecar 错误 modal。spec Section 7：暴露 + 完整信息 + 复制按钮
 * @author Atlas.oi
 * @date 2026-04-17
 */
import { useEffect, useState } from 'react';
import { SidecarError } from './toolsSidecarClient';

interface Props {
  error: SidecarError | null;
  onClose: () => void;
  onRestart?: () => void;
}

export function ErrorModal({ error, onClose, onRestart }: Props) {
  const [copied, setCopied] = useState(false);

  // 切换 error 时重置复制状态
  useEffect(() => {
    if (!error) setCopied(false);
  }, [error]);

  if (!error) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(`[${error.code}]\n${error.fullError}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      alert('复制失败，请手动选择文本');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0,
        background: 'var(--c-overlay-backdrop)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--c-overlay)',
          border: '1px solid var(--c-border)',
          borderRadius: 'var(--r-lg)',
          padding: 24,
          maxWidth: 720,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          boxShadow: 'var(--shadow-lg)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题行：错误码 */}
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-danger)' }}>
          工具执行失败 [{error.code}]
        </div>

        {/* 完整错误信息（保留换行、traceback 等） */}
        <pre
          style={{
            flex: 1, overflow: 'auto',
            padding: 12,
            background: 'var(--c-raised)',
            borderRadius: 'var(--r-sm)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--c-fg)',
            whiteSpace: 'pre-wrap',
            maxHeight: 400,
          }}
        >
          {error.fullError}
        </pre>

        {/* 操作按钮行 */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={handleCopy}
            style={{
              padding: '8px 14px',
              background: 'var(--c-raised)',
              color: 'var(--c-fg)',
              border: '1px solid var(--c-border)',
              borderRadius: 'var(--r-sm)',
              cursor: 'pointer',
              fontFamily: 'var(--font-ui)',
              fontSize: 13,
            }}
          >
            {copied ? '已复制' : '复制完整错误信息'}
          </button>
          {onRestart && (
            <button
              onClick={onRestart}
              style={{
                padding: '8px 14px',
                background: 'var(--c-raised)',
                color: 'var(--c-fg)',
                border: '1px solid var(--c-border)',
                borderRadius: 'var(--r-sm)',
                cursor: 'pointer',
                fontFamily: 'var(--font-ui)',
                fontSize: 13,
              }}
            >
              重启 sidecar
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              padding: '8px 14px',
              background: 'var(--c-accent)',
              color: 'var(--c-accent-text)',
              border: 'none',
              borderRadius: 'var(--r-sm)',
              cursor: 'pointer',
              fontFamily: 'var(--font-ui)',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
