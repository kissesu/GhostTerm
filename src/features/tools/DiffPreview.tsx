/**
 * @file DiffPreview.tsx
 * @description 修复前 diff 预览 modal。展示 unified diff，- 行红色 / + 行绿色，
 *   操作行提供"确认修复"与"取消"按钮，busy 时两按钮均禁用。
 * @author Atlas.oi
 * @date 2026-04-18
 */

interface Props {
  diff: string;
  onConfirm(): void;
  onCancel(): void;
  busy: boolean;
}

// 按行首字符决定语义类型，MVP 接受 file header 也被染色
function lineType(line: string): 'remove' | 'add' | 'context' {
  if (line.startsWith('-')) return 'remove';
  if (line.startsWith('+')) return 'add';
  return 'context';
}

// 语义类型映射到 CSS 变量前景色
const LINE_COLOR: Record<'remove' | 'add' | 'context', string> = {
  remove: 'var(--c-danger)',
  add: 'var(--c-success)',
  context: 'var(--c-fg)',
};

export function DiffPreview({ diff, onConfirm, onCancel, busy }: Props) {
  const lines = diff.split('\n');

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
      onClick={onCancel}
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
        {/* 标题 */}
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-fg)' }}>
          修复预览
        </div>

        {/* diff 内容：每行独立 span，携带语义属性供测试断言 */}
        <pre
          style={{
            flex: 1, overflow: 'auto',
            padding: 12,
            background: 'var(--c-raised)',
            borderRadius: 'var(--r-sm)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            maxHeight: 400,
            margin: 0,
          }}
        >
          {lines.map((line, i) => {
            const type = lineType(line);
            return (
              <span
                key={i}
                data-line-type={type}
                style={{ color: LINE_COLOR[type], display: 'block' }}
              >
                {line}
              </span>
            );
          })}
        </pre>

        {/* 操作按钮行 */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            disabled={busy}
            style={{
              padding: '8px 14px',
              background: 'var(--c-raised)',
              color: 'var(--c-fg)',
              border: '1px solid var(--c-border)',
              borderRadius: 'var(--r-sm)',
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.5 : 1,
              fontFamily: 'var(--font-ui)',
              fontSize: 13,
            }}
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            style={{
              padding: '8px 14px',
              background: 'var(--c-accent)',
              color: 'var(--c-accent-text)',
              border: 'none',
              borderRadius: 'var(--r-sm)',
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.5 : 1,
              fontFamily: 'var(--font-ui)',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            确认修复
          </button>
        </div>
      </div>
    </div>
  );
}
