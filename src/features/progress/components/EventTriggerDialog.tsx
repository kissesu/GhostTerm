/**
 * @file EventTriggerDialog.tsx
 * @description 事件触发弹窗 - 1:1 复刻设计稿 line 417-496（modal 容器 + transition 行 + field 控件）
 *              + line 870-933（fields 动态渲染 + 提交流程）
 *
 *              业务流程（plan §1 决策预存清单 + Task 19）：
 *              1. 通过 findActionMeta(eventCode) 反查 ActionMeta 拿 fields/transitionTo
 *              2. 顶部 transition 行：StatusPill(fromStatus) → StatusPill(action.transitionTo) + eventCode 角标
 *              3. 按 ActionMeta.fields 顺序渲染 input/textarea/select；首个字段自动 focus
 *              4. zod schema buildSchema(action) 客户端校验 → required 缺失提示"此字段必填"
 *              5. 提交：note 字段单独抽出 trim 后作为 remark；其余非空字段拼到 [fields] JSON
 *              6. 成功 toast + onSuccess 回调；失败显示 submitError
 *              7. ESC 关闭；overlay 点空白关闭；role=dialog + aria-modal + aria-labelledby（C1 a11y）
 *
 *              注意 CSS module 中 transition 类名为 modalTransition（progress.module.css I5）。
 *              ref 用 callback 形式避免 union ref type 转换报错。
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { useState, useEffect, useRef, type ReactElement, type FormEvent } from 'react';
import { z } from 'zod';
import styles from '../progress.module.css';
import { useProjectsStore } from '../stores/projectsStore';
import { useToastStore } from '../stores/toastStore';
import { findActionMeta, STATUS_LABEL, type ActionMeta } from '../config/nbaConfig';
import type { EventCode, ProjectStatus } from '../api/projects';
import { StatusPill } from './StatusPill';

interface EventTriggerDialogProps {
  projectId: number;
  /** 当前 status，用于 transition pill 左侧 */
  fromStatus: ProjectStatus;
  /** 触发的事件 code */
  event: EventCode;
  /** 弹窗标题文案（设计稿 modal-head h3） */
  eventLabel: string;
  onClose: () => void;
  onSuccess?: () => void;
}

/**
 * 按 ActionMeta.fields 动态构建 zod schema
 *
 * 业务规则：
 * - required=true 的 number 字段：trim 非空 + 可转 Number
 * - required=true 的 text/textarea/select 字段：trim 非空
 * - required=false：通过 .optional() 容忍空字符串
 *
 * 错误信息统一为"此字段必填"（plan §Task 19 验收）
 */
function buildSchema(action: ActionMeta) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of action.fields) {
    if (f.type === 'number') {
      const s = f.required
        ? z.string().refine((v) => v.trim() !== '' && !Number.isNaN(Number(v)), {
            message: '此字段必填',
          })
        : z.string().optional();
      shape[f.name] = s;
    } else {
      const s = f.required
        ? z.string().refine((v) => v.trim().length > 0, { message: '此字段必填' })
        : z.string().optional();
      shape[f.name] = s;
    }
  }
  return z.object(shape);
}

export function EventTriggerDialog({
  projectId,
  fromStatus,
  event,
  eventLabel,
  onClose,
  onSuccess,
}: EventTriggerDialogProps): ReactElement {
  const action = findActionMeta(event);
  const fields = action?.fields ?? [];
  const titleId = `event-dialog-title-${event}`;

  // 表单值：每个字段都用 string 存（number 类型也走 string 在提交时再 parse）
  const [formValues, setFormValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, ''])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 首个字段 focus；callback ref 兼容 input/textarea/select 三种节点类型
  const firstFieldRef = useRef<HTMLElement | null>(null);

  const triggerEvent = useProjectsStore((s) => s.triggerEvent);
  const showToast = useToastStore((s) => s.show);

  // 自动 focus 第一字段（mount 时）
  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!action) {
      // ============================================
      // 异常：未知 eventCode → 不调 triggerEvent，直接提示
      // 这里不静默 fallback，按 plan §0.4 暴露问题
      // ============================================
      setSubmitError('未知事件配置');
      return;
    }

    const schema = buildSchema(action);
    const result = schema.safeParse(formValues);
    if (!result.success) {
      const errs: Record<string, string> = {};
      result.error.issues.forEach((iss) => {
        const key = String(iss.path[0] ?? '');
        if (key && !errs[key]) errs[key] = iss.message;
      });
      setErrors(errs);
      return;
    }
    setErrors({});

    setSubmitting(true);
    try {
      // ============================================
      // 拼装 remark：
      // 1. note 字段（约定）作为人类可读主体
      // 2. 其余字段（金额/方式/截止等）trim 后非空才拼成 [fields] JSON 附加
      // 3. 这样后端 status_change_logs.remark 可读 + 机器可解析
      // ============================================
      const noteValue = (formValues.note ?? '').trim();
      const otherFields: Record<string, string> = {};
      for (const f of action.fields) {
        if (f.name === 'note') continue;
        const v = (formValues[f.name] ?? '').trim();
        if (v !== '') otherFields[f.name] = v;
      }
      const hasOther = Object.keys(otherFields).length > 0;
      const remark = hasOther
        ? (noteValue ? noteValue + '\n' : '') + '[fields]' + JSON.stringify(otherFields)
        : noteValue;

      await triggerEvent(projectId, { event, remark, newHolderUserId: null });
      showToast(
        `${action.label} 完成 · ${STATUS_LABEL[fromStatus]} → ${STATUS_LABEL[action.transitionTo]}`,
      );
      onSuccess?.();
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={styles.modalOverlay + ' ' + styles.modalOverlayOpen}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="event-trigger-dialog"
      >
        <div className={styles.modalHead}>
          <h3 id={titleId}>{eventLabel}</h3>
          <button
            type="button"
            className={styles.modalClose}
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className={styles.modalBody}>
            <div className={styles.modalTransition} data-testid="event-transition">
              <StatusPill status={fromStatus} />
              <svg
                width="16"
                height="16"
                viewBox="0 0 20 20"
                style={{ color: 'var(--muted)' }}
                aria-hidden="true"
              >
                <path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth={2} fill="none" />
              </svg>
              {action && <StatusPill status={action.transitionTo} />}
              <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 11 }}>
                {event}
              </span>
            </div>

            {fields.map((f, idx) => {
              const inputId = `event-trigger-${f.name}`;
              const fieldError = errors[f.name];
              const value = formValues[f.name] ?? '';
              const onChange = (next: string) =>
                setFormValues((s) => ({ ...s, [f.name]: next }));

              // 首个字段挂 ref；callback 形式兼容三种节点
              const setFirstRef = (el: HTMLElement | null) => {
                if (idx === 0) firstFieldRef.current = el;
              };

              let control: ReactElement;
              if (f.type === 'textarea') {
                control = (
                  <textarea
                    id={inputId}
                    ref={setFirstRef}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={f.placeholder}
                    aria-invalid={fieldError ? true : undefined}
                  />
                );
              } else if (f.type === 'select') {
                control = (
                  <select
                    id={inputId}
                    ref={setFirstRef}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    aria-invalid={fieldError ? true : undefined}
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
                // text / number 都走 input；type 透传 native 类型让浏览器做基础校验
                control = (
                  <input
                    id={inputId}
                    type={f.type}
                    ref={setFirstRef}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={f.placeholder}
                    aria-invalid={fieldError ? true : undefined}
                  />
                );
              }

              return (
                <div key={f.name} className={styles.field}>
                  <label htmlFor={inputId}>
                    {f.label}
                    {f.required ? ' *' : ''}
                  </label>
                  {control}
                  {fieldError && (
                    <p className={styles.fieldError} data-testid={`field-error-${f.name}`}>
                      {fieldError}
                    </p>
                  )}
                </div>
              );
            })}

            {submitError && (
              <p className={styles.fieldError} data-testid="submit-error">
                {submitError}
              </p>
            )}
          </div>
          <div className={styles.modalFoot}>
            <button type="button" className={styles.btn} onClick={onClose}>
              取消
            </button>
            <button type="submit" className={styles.btnPrimary} disabled={submitting}>
              {submitting ? '提交中…' : '确认提交'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
