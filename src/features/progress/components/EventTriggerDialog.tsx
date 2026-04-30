/**
 * @file EventTriggerDialog.tsx
 * @description 事件触发对话框（Phase 11） —— 为单次状态机事件提供模态表单。
 *
 *              业务流程（spec §6.2 + plan part3 §I2）：
 *              1. 用户在 EventActionButtons 点击事件按钮 → 本对话框打开
 *              2. note 必填（项目 project_events.note 列 NOT NULL）
 *              3. 部分事件需要附加 payload：
 *                 - E11 (归档) 不需要附加（仅 note）
 *                 - E10 (确认收款) 不需要附加（仅 note）
 *                 - 其它事件目前 v1 仅需 note；未来可扩展
 *              4. 提交 → projectsStore.triggerEvent(...) 推进状态机
 *              5. 成功 → onSuccess + 关闭；失败 → 红色错误条 + 保留弹窗
 *
 *              焦点陷阱（plan part3 §I2）：
 *              - 挂载后焦点落在 note textarea
 *              - Tab 在最后一个可聚焦元素时回到第一个；Shift+Tab 反向
 *              - Escape 关闭弹窗（等同点击取消）
 *
 *              不在本组件做：
 *              - 不做 portal / overlay：调用方决定 modal 容器（保持组件纯净）
 *              - 不集成 QuoteChange/Feedback 子表单：Phase 11 v1 单事件仅需 note；
 *                复合事件由后续 Phase 通过更专门的对话框（QuoteChangeDialog）处理
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { useEffect, useRef, useState, type ReactElement, type FormEvent, type KeyboardEvent } from 'react';

import type { EventCode } from '../api/projects';
import { useProjectsStore } from '../stores/projectsStore';

interface EventTriggerDialogProps {
  /** 关联项目 id */
  projectId: number;
  /** 待触发事件代码 */
  event: EventCode;
  /** 事件可读标签（按钮上的中文文案） */
  eventLabel: string;
  /** 取消 / 关闭弹窗 */
  onClose: () => void;
  /** 触发成功后的回调（caller 决定 toast / refresh） */
  onSuccess?: () => void;
}

/**
 * 单次事件触发对话框。
 *
 * 业务流程：
 * 1. 用户填写 note（必填）
 * 2. 提交时触发 store.triggerEvent；状态机校验失败由后端透出 error
 * 3. 成功 → onSuccess + onClose
 */
export function EventTriggerDialog({
  projectId,
  event,
  eventLabel,
  onClose,
  onSuccess,
}: EventTriggerDialogProps): ReactElement {
  const triggerEvent = useProjectsStore((s) => s.triggerEvent);

  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 焦点陷阱：root 元素 + textarea / 按钮 ref
  const rootRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  // ============================================
  // 挂载后：焦点落到 note；Escape 全局监听
  // ============================================
  useEffect(() => {
    noteRef.current?.focus();
  }, []);

  // ============================================
  // 焦点陷阱实现（Tab / Shift+Tab 循环）
  // 业务背景（plan part3 §I2）：
  // 模态对话框必须把 Tab 焦点限制在弹窗内，避免用户 tab 出去操作背后的列表
  // ============================================
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;

    const root = rootRef.current;
    if (!root) return;

    // 收集弹窗内可聚焦元素
    const focusables = root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;

    if (e.shiftKey) {
      // Shift+Tab：在第一个元素时跳到最后一个
      if (active === first || !root.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      // Tab：在最后一个元素时跳到第一个
      if (active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  // ============================================
  // 提交：校验 note 非空 + 调 store.triggerEvent
  // ============================================
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = note.trim();
    if (trimmed.length < 1) {
      setError('备注不能为空');
      return;
    }

    setSubmitting(true);
    try {
      await triggerEvent(projectId, {
        event,
        remark: trimmed,
        newHolderUserId: null,
      });
      onSuccess?.();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={`触发事件 ${eventLabel}`}
      aria-modal="true"
      data-testid="event-trigger-dialog"
      data-event={event}
      onKeyDown={handleKeyDown}
      style={{
        background: 'var(--c-panel)',
        color: 'var(--c-fg)',
        border: '1px solid var(--c-border)',
        borderRadius: 8,
        padding: 20,
        minWidth: 360,
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      }}
    >
      <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600 }}>{eventLabel}</h3>

      <form onSubmit={handleSubmit} noValidate>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--c-fg-muted)' }}>
            备注 <span style={{ color: 'var(--c-red, #d8453b)' }}>*</span>
          </span>
          <textarea
            ref={noteRef}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={submitting}
            data-testid="event-trigger-note"
            rows={4}
            placeholder="请描述此次操作的原因 / 上下文"
            style={{
              padding: '6px 8px',
              borderRadius: 4,
              border: '1px solid var(--c-border)',
              background: 'var(--c-bg)',
              color: 'var(--c-fg)',
              fontSize: 13,
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
          />
        </label>

        {error !== null && (
          <div
            data-testid="event-trigger-error"
            role="alert"
            style={{
              fontSize: 12,
              color: 'var(--c-red, #d8453b)',
              marginBottom: 10,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            data-testid="event-trigger-cancel"
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid var(--c-border)',
              background: 'transparent',
              color: 'var(--c-fg)',
              cursor: submitting ? 'not-allowed' : 'pointer',
              fontSize: 13,
            }}
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting}
            data-testid="event-trigger-submit"
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: 'none',
              background: 'var(--c-accent)',
              color: 'var(--c-on-accent, var(--c-bg))',
              cursor: submitting ? 'not-allowed' : 'pointer',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            {submitting ? '提交中…' : '触发'}
          </button>
        </div>
      </form>
    </div>
  );
}
