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
      border: '1px solid #4b67c0',
      background: '#4c6ef5',
      color: '#eef0ff',
      fontWeight: 600,
      cursor: 'pointer',
    };
  }

  if (variant === 'danger') {
    return {
      border: '1px solid #763b46',
      background: '#5a2b34',
      color: '#ffd9dd',
      fontWeight: 600,
      cursor: 'pointer',
    };
  }

  return {
    border: '1px solid #353852',
    background: '#26293d',
    color: '#c0caf5',
    fontWeight: 500,
    cursor: 'pointer',
  };
}

export function dialogInputStyle(): CSSProperties {
  return {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid #353852',
    background: '#16161e',
    color: '#eef0ff',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box',
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
      if (event.key === 'Escape') {
        onClose();
      }
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
        background: 'rgba(0,0,0,0.56)',
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
          borderRadius: 16,
          border: '1px solid #353852',
          background: '#1e2030',
          boxShadow: '0 22px 50px rgba(0,0,0,0.35)',
          padding: '24px 24px 20px',
          boxSizing: 'border-box',
        }}
        data-testid={testId}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#eef0ff' }}>{title}</h2>
            {description ? (
              <div style={{ marginTop: 8, fontSize: 12, color: '#8f96b5', lineHeight: 1.55 }}>{description}</div>
            ) : null}
          </div>
          <button
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#6f748f',
              padding: 4,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {children ? <div style={{ marginTop: 18 }}>{children}</div> : null}

        {footer ? (
          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
