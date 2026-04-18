/**
 * @file NamePromptModal.tsx
 * @description 替代 window.prompt 的模态输入框。
 *   Tauri 2 WebView 禁用了原生 window.prompt()，点击按钮无响应。
 *   此组件提供同等的"输入一个字符串"体验，以受控 React 组件实现。
 * @author Atlas.oi
 * @date 2026-04-18
 */

import { useState, useEffect } from 'react';

interface Props {
  isOpen: boolean;
  title: string;
  defaultValue?: string;
  placeholder?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

export function NamePromptModal({
  isOpen,
  title,
  defaultValue,
  placeholder,
  onSubmit,
  onCancel,
}: Props) {
  const [value, setValue] = useState(defaultValue ?? '');

  // isOpen 变化时重置输入框内容（每次打开都从 defaultValue 开始）
  useEffect(() => {
    if (isOpen) setValue(defaultValue ?? '');
  }, [isOpen, defaultValue]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    // 遮罩层：点击遮罩取消
    <div
      role="dialog"
      aria-modal="true"
      data-testid="name-prompt-modal"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--c-overlay-backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // 高于 TemplateManager (1000) 和 TemplateExtractor (1100)
        zIndex: 1200,
      }}
      onClick={onCancel}
    >
      {/* 卡片：阻止冒泡，防止点内容区时触发遮罩取消 */}
      <div
        style={{
          background: 'var(--c-overlay)',
          border: '1px solid var(--c-border)',
          borderRadius: 'var(--r-lg)',
          padding: 24,
          minWidth: 360,
          maxWidth: '80vw',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          boxShadow: 'var(--shadow-lg)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--c-fg)',
            fontFamily: 'var(--font-ui)',
          }}
        >
          {title}
        </div>

        {/* 输入框 */}
        <input
          type="text"
          data-testid="name-prompt-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          // autoFocus 让用户无需鼠标点击即可输入
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
            if (e.key === 'Escape') onCancel();
          }}
          style={{
            padding: '8px 12px',
            background: 'var(--c-raised)',
            color: 'var(--c-fg)',
            border: '1px solid var(--c-border)',
            borderRadius: 'var(--r-sm)',
            fontSize: 13,
            fontFamily: 'var(--font-ui)',
            outline: 'none',
          }}
        />

        {/* 按钮行 */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
          }}
        >
          <button
            data-testid="name-prompt-cancel"
            onClick={onCancel}
            style={{
              padding: '6px 14px',
              background: 'var(--c-raised)',
              color: 'var(--c-fg-muted)',
              border: '1px solid var(--c-border)',
              borderRadius: 'var(--r-sm)',
              fontSize: 13,
              fontFamily: 'var(--font-ui)',
              cursor: 'pointer',
            }}
          >
            取消
          </button>
          <button
            data-testid="name-prompt-submit"
            onClick={handleSubmit}
            disabled={!value.trim()}
            style={{
              padding: '6px 14px',
              background: value.trim() ? 'var(--c-accent)' : 'var(--c-raised)',
              color: value.trim() ? 'var(--c-accent-text)' : 'var(--c-fg-subtle)',
              border: 'none',
              borderRadius: 'var(--r-sm)',
              fontSize: 13,
              fontFamily: 'var(--font-ui)',
              cursor: value.trim() ? 'pointer' : 'default',
              fontWeight: 500,
            }}
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}
