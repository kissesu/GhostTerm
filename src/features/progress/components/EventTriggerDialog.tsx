/**
 * @file EventTriggerDialog.tsx
 * @description 事件触发对话框（Phase 11 + Task 12 重写） —— 动态字段 + zod 校验。
 *
 *              业务流程（spec §6.2 + plan part3 §I2 + plan §Task 12 C2/C4）：
 *              1. 用户在 NbaPanel 点击 CTA 按钮 → 本对话框打开
 *              2. 根据 event 在 NBA_CONFIG 查 ActionMeta，按 fields 配置动态渲染
 *                 input/textarea/select；required 字段做 zod 校验
 *              3. 提交时所有 required 字段非空 → 调 store.triggerEvent 推进状态机
 *              4. 非 note 字段编码进 remark JSON 后缀（"<note>\n[fields]<json>"），
 *                 后端 API 协议保持不变
 *              5. 成功 → onSuccess + 关闭；失败 → 红色错误条 + 保留弹窗
 *
 *              焦点陷阱（plan part3 §I2）：
 *              - 挂载后焦点落在第一个字段
 *              - Tab 在最后一个可聚焦元素时回到第一个；Shift+Tab 反向
 *              - Escape 关闭弹窗（等同点击取消）
 *
 *              不在本组件做：
 *              - 不做 portal / overlay：调用方决定 modal 容器
 *              - 不集成 QuoteChange/Feedback 子表单：复合事件由专门的对话框处理
 *
 * @author Atlas.oi
 * @date 2026-04-30
 */

import { useEffect, useRef, useState, type ReactElement, type FormEvent, type KeyboardEvent } from 'react';
import { z } from 'zod';

import type { EventCode } from '../api/projects';
import { useProjectsStore } from '../stores/projectsStore';
import { NBA_CONFIG, type ActionMeta } from '../config/nbaConfig';

import styles from '../progress.module.css';

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

// ============================================================================
// 模块级辅助：从 NBA_CONFIG 反查事件元数据 + 构建 zod schema
// ============================================================================

/**
 * 在 NBA_CONFIG 内反查事件配置：扫描所有 status 的 primaryAction + secondary。
 *
 * 业务背景：Task 12 对话框需要按事件 code 取 fields；而 NBA_CONFIG 是按 status 编排，
 * 一个事件可能同时是某 status 的次级动作（如 E12 取消项目在 dealing/quoting/developing
 * /confirming/delivered 五个 status 下都有），但 fields 配置等价，取首个匹配即可。
 */
function findActionMeta(eventCode: EventCode): ActionMeta | null {
  for (const cfg of Object.values(NBA_CONFIG)) {
    if (cfg.primaryAction.eventCode === eventCode) return cfg.primaryAction;
    const sec = cfg.secondary.find((s) => s.eventCode === eventCode);
    if (sec) return sec;
  }
  return null;
}

/**
 * 按 ActionMeta.fields 构建 zod schema：
 * - required 字段：trim 后非空（type=number 还要求可被 Number() 解析）
 * - 可选字段：z.string().optional()
 *
 * 错误信息统一中文 "此字段必填"，便于 UI 直接展示。
 */
function buildSchema(action: ActionMeta) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of action.fields) {
    if (f.type === 'number') {
      const required = f.required ?? false;
      shape[f.name] = required
        ? z
            .string()
            .refine((v) => v.trim() !== '' && !Number.isNaN(Number(v)), {
              message: '此字段必填',
            })
        : z.string().optional();
    } else {
      const required = f.required ?? false;
      shape[f.name] = required
        ? z.string().refine((v) => v.trim().length > 0, { message: '此字段必填' })
        : z.string().optional();
    }
  }
  return z.object(shape);
}

/**
 * 单次事件触发对话框（动态字段版）。
 *
 * 业务流程：
 * 1. 在 NBA_CONFIG 查找 event 对应 ActionMeta；缺省时显示"未知事件配置"
 * 2. 按 fields 渲染 input/textarea/select
 * 3. 提交：zod 校验 → 失败显示 per-field "此字段必填" 提示并阻断
 * 4. 校验通过：把 note 之外的字段编码到 remark 的 [fields] JSON 后缀
 * 5. 调 store.triggerEvent；成功 → onSuccess + onClose；失败 → 顶部错误条
 */
export function EventTriggerDialog({
  projectId,
  event,
  eventLabel,
  onClose,
  onSuccess,
}: EventTriggerDialogProps): ReactElement {
  const triggerEvent = useProjectsStore((s) => s.triggerEvent);

  // 用于 aria-labelledby 关联对话框标题，保证无障碍朗读器可识别弹窗名称
  const titleId = `event-dialog-title-${event}`;

  // 反查事件 meta（meta 缺失时仍然渲染对话框框架，submit 阶段拦截给出错误）
  const action = findActionMeta(event);
  const fields = action?.fields ?? [];

  // 表单值：lazy init 一次（dialog 在每次打开时由 caller 重新挂载，故无需 reset）
  const [formValues, setFormValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, ''])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 焦点陷阱：root 元素 + 第一个字段 ref（兼容 textarea / input / select）
  const rootRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLTextAreaElement | HTMLInputElement | HTMLSelectElement | null>(null);

  // ============================================
  // 挂载后：焦点落到第一个字段
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
  // 提交：zod 校验 → 编码 remark → 调 store.triggerEvent
  //
  // 业务流程：
  // 1. zod safeParse 检查 required 字段
  // 2. 失败：把 issues 摊到 errors map，触发 per-field 错误提示渲染
  // 3. 成功：note 字段直接做 remark 主体；其它字段编码 [fields] JSON 后缀
  //    （后端 API 协议保持不变，remark 列存原文 + 结构化 JSON 备查）
  // ============================================
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!action) {
      setError('未知事件配置');
      return;
    }

    const schema = buildSchema(action);
    const result = schema.safeParse(formValues);
    if (!result.success) {
      const errs: Record<string, string> = {};
      result.error.issues.forEach((iss) => {
        const path = String(iss.path[0]);
        errs[path] = iss.message;
      });
      setErrors(errs);
      return;
    }
    setErrors({});

    setSubmitting(true);
    try {
      const noteValue = (formValues.note ?? '').trim();
      // 非 note 字段：仅保留有内容的字段，避免 remark JSON 充斥空值
      const otherFields: Record<string, string> = {};
      for (const [k, v] of Object.entries(formValues)) {
        if (k === 'note') continue;
        if ((v ?? '').trim() !== '') otherFields[k] = v;
      }
      const hasOther = Object.keys(otherFields).length > 0;
      const remark = hasOther
        ? noteValue + '\n[fields]' + JSON.stringify(otherFields)
        : noteValue;

      await triggerEvent(projectId, {
        event,
        remark,
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
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="event-trigger-dialog"
      data-event={event}
      onKeyDown={handleKeyDown}
      style={{
        background: 'var(--panel)',
        color: 'var(--text)',
        border: '1px solid var(--line-strong)',
        borderRadius: 9,
        padding: '20px 22px',
        minWidth: 380,
        maxWidth: 480,
        boxShadow: 'var(--shadow)',
        fontFamily: 'inherit',
      }}
    >
      <h3 id={titleId} style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 800, color: 'var(--text)', letterSpacing: 0.2 }}>
        {eventLabel}
      </h3>

      <form onSubmit={handleSubmit} noValidate className={styles.eventTriggerForm}>
        {fields.map((f, idx) => {
          const inputId = `event-trigger-${f.name}`;
          const fieldError = errors[f.name];
          const value = formValues[f.name] ?? '';
          const onChange = (next: string) =>
            setFormValues((s) => ({ ...s, [f.name]: next }));

          // note 字段保留 testid 兼容现有外部测试
          const isNoteField = f.name === 'note';

          let control: ReactElement;
          if (f.type === 'textarea') {
            control = (
              <textarea
                id={inputId}
                ref={
                  idx === 0
                    ? (noteRef as React.RefObject<HTMLTextAreaElement>)
                    : undefined
                }
                value={value}
                onChange={(ev) => onChange(ev.target.value)}
                disabled={submitting}
                placeholder={f.placeholder}
                rows={4}
                className={styles.textareaBox}
                data-testid={isNoteField ? 'event-trigger-note' : undefined}
                aria-invalid={fieldError ? 'true' : undefined}
                aria-describedby={fieldError ? inputId + '-err' : undefined}
              />
            );
          } else if (f.type === 'select') {
            control = (
              <select
                id={inputId}
                ref={
                  idx === 0
                    ? (noteRef as unknown as React.RefObject<HTMLSelectElement>)
                    : undefined
                }
                value={value}
                onChange={(ev) => onChange(ev.target.value)}
                disabled={submitting}
                className={styles.selectBox}
                aria-invalid={fieldError ? 'true' : undefined}
                aria-describedby={fieldError ? inputId + '-err' : undefined}
              >
                <option value="">请选择…</option>
                {(f.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            );
          } else {
            // text / number 走 input
            control = (
              <input
                id={inputId}
                type={f.type}
                ref={
                  idx === 0
                    ? (noteRef as unknown as React.RefObject<HTMLInputElement>)
                    : undefined
                }
                value={value}
                onChange={(ev) => onChange(ev.target.value)}
                disabled={submitting}
                placeholder={f.placeholder}
                className={styles.inputBox}
                aria-invalid={fieldError ? 'true' : undefined}
                aria-describedby={fieldError ? inputId + '-err' : undefined}
              />
            );
          }

          return (
            <div key={f.name} className={styles.dialogField}>
              <label htmlFor={inputId} className={styles.dialogFieldLabel}>
                {f.label}
                {f.required ? (
                  <span style={{ color: 'var(--red)', marginLeft: 2 }}>*</span>
                ) : null}
              </label>
              {control}
              {fieldError && (
                <p id={inputId + '-err'} className={styles.fieldError}>
                  {fieldError}
                </p>
              )}
            </div>
          );
        })}

        {error !== null && (
          <div
            data-testid="event-trigger-error"
            role="alert"
            style={{
              padding: '8px 12px',
              border: '1px solid rgba(239, 104, 98, 0.4)',
              borderRadius: 6,
              background: 'rgba(239, 104, 98, 0.1)',
              color: '#ffd8d4',
              fontSize: 12,
              marginBottom: 12,
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
              height: 32,
              padding: '0 14px',
              borderRadius: 6,
              border: '1px solid var(--line)',
              background: '#11110f',
              color: 'var(--muted)',
              cursor: submitting ? 'not-allowed' : 'pointer',
              fontSize: 12,
              fontWeight: 800,
              fontFamily: 'inherit',
            }}
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting}
            data-testid="event-trigger-submit"
            style={{
              height: 32,
              padding: '0 14px',
              borderRadius: 6,
              border: '1px solid transparent',
              background: 'var(--accent)',
              color: 'var(--accent-ink)',
              cursor: submitting ? 'not-allowed' : 'pointer',
              fontSize: 12,
              fontWeight: 800,
              fontFamily: 'inherit',
            }}
          >
            {submitting ? '提交中…' : '触发'}
          </button>
        </div>
      </form>
    </div>
  );
}
