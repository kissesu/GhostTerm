/**
 * @file SidebarDialog.tsx - 侧边栏通用对话框组件
 * @description 半透明遮罩 + 居中弹窗，供新建/重命名/删除分组等场景使用。
 *              样式全部使用 CSS 自定义属性适配主题。
 * @author Atlas.oi
 * @date 2026-04-15
 */

import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface SidebarDialogProps {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
  closeLabel?: string;
  testId?: string;
}

export function dialogButtonStyle(variant: 'secondary' | 'primary' | 'danger' = 'secondary'): CSSProperties {
  if (variant === 'primary') {
    return {
      border: '1px solid var(--c-accent)',
      background: 'var(--c-accent)',
      color: 'var(--c-accent-text)',
      fontWeight: 600,
      cursor: 'pointer',
    };
  }
  if (variant === 'danger') {
    return {
      border: '1px solid var(--c-danger)',
      background: 'var(--c-danger-dim)',
      color: 'var(--c-danger)',
      fontWeight: 600,
      cursor: 'pointer',
    };
  }
  return {
    border: '1px solid var(--c-border)',
    background: 'var(--c-raised)',
    color: 'var(--c-fg)',
    fontWeight: 500,
    cursor: 'pointer',
  };
}

export function dialogInputStyle(): CSSProperties {
  return {
    width: '100%',
    padding: '9px 12px',
    borderRadius: 'var(--r-md)',
    border: '1px solid var(--c-border)',
    background: 'var(--c-input)',
    color: 'var(--c-fg)',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'var(--font-ui)',
  };
}

export default function SidebarDialog({
  title,
  description,
  onClose,
  children,
  footer,
  width = 420,
  closeLabel = '关闭对话框',
  testId,
}: SidebarDialogProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'oklch(0% 0 0 / 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        zIndex: 1200,
      }}
      data-testid={testId ? `${testId}-overlay` : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(100%, 100%)',
          maxWidth: width,
          borderRadius: 'var(--r-xl)',
          border: '1px solid var(--c-border)',
          background: 'var(--c-overlay)',
          boxShadow: 'var(--shadow-lg)',
          padding: '22px 22px 18px',
          boxSizing: 'border-box',
        }}
        data-testid={testId}
      >
        {/* 标题行 */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--c-fg)' }}>
              {title}
            </h2>
            {description ? (
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--c-fg-muted)', lineHeight: 1.55 }}>
                {description}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--c-fg-subtle)',
              padding: 4,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 'var(--r-xs)',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {children ? <div style={{ marginTop: 16 }}>{children}</div> : null}

        {footer ? (
          <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
