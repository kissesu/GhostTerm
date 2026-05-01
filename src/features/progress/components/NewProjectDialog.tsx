/**
 * @file NewProjectDialog.tsx
 * @description 新建项目 modal - 弥补 plan/设计稿未列的 e2e 起点缺口
 *              字段：name / customerLabel / description / priority / thesisLevel / subject / deadline / originalQuote
 *              复用 progress.module.css 的 .modal/.field/.btn 样式 + zod 客户端校验
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { useEffect, useRef, useState, type ChangeEvent, type ReactElement } from 'react';
import { z } from 'zod';
import styles from '../progress.module.css';
import { useProjectsStore } from '../stores/projectsStore';
import { useToastStore } from '../stores/toastStore';
import type { CreateProjectInput, ProjectPriority, ThesisLevel } from '../api/projects';

interface NewProjectDialogProps {
  onClose: () => void;
  onSuccess?: (id: number) => void;
}

// 字段 zod schema：除 description / subject / originalQuote 外其余必填
const Schema = z.object({
  name: z.string().min(1, '此字段必填'),
  customerLabel: z.string().min(1, '此字段必填'),
  description: z.string().min(1, '此字段必填'),
  priority: z.enum(['urgent', 'normal']),
  thesisLevel: z.enum(['bachelor', 'master', 'doctor']),
  subject: z.string().optional(),
  deadline: z.string().min(1, '此字段必填'),
  originalQuote: z.string().optional(),
});

export function NewProjectDialog({ onClose, onSuccess }: NewProjectDialogProps): ReactElement {
  const create = useProjectsStore((s) => s.create);
  const showToast = useToastStore((s) => s.show);
  const firstRef = useRef<HTMLInputElement | null>(null);

  // 默认 deadline = 今天 + 14 天（表单友好默认）
  const defaultDeadline = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10); // yyyy-mm-dd
  })();

  const [form, setForm] = useState({
    name: '',
    customerLabel: '',
    description: '',
    priority: 'normal' as ProjectPriority,
    thesisLevel: 'master' as ThesisLevel,
    subject: '',
    deadline: defaultDeadline,
    originalQuote: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const update = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm({ ...form, [k]: e.target.value });
    if (errors[k]) {
      const next = { ...errors }; delete next[k]; setErrors(next);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Schema.safeParse(form);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      parsed.error.issues.forEach((i) => { errs[String(i.path[0])] = i.message; });
      setErrors(errs);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      // deadline 转 ISO 8601（后端要 RFC3339）
      const isoDeadline = new Date(form.deadline + 'T23:59:59').toISOString();
      const input: CreateProjectInput = {
        name: form.name.trim(),
        customerLabel: form.customerLabel.trim(),
        description: form.description.trim(),
        priority: form.priority,
        thesisLevel: form.thesisLevel,
        deadline: isoDeadline,
      };
      if (form.subject.trim()) input.subject = form.subject.trim();
      if (form.originalQuote.trim()) input.originalQuote = form.originalQuote.trim();
      const created = await create(input);
      showToast('项目已创建 · ' + created.name);
      onSuccess?.(created.id);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`${styles.modalOverlay} ${styles.modalOverlayOpen}`} role="dialog" aria-modal="true" aria-labelledby="new-project-title">
      <div className={styles.modal}>
        <div className={styles.modalHead}>
          <h3 id="new-project-title">新建项目</h3>
          <button type="button" className={styles.modalClose} aria-label="关闭" onClick={onClose}>×</button>
        </div>
        <form onSubmit={submit}>
          <div className={styles.modalBody}>
            <div className={styles.field}>
              <label htmlFor="np-name">项目名 <span style={{ color: 'var(--red)' }}>*</span></label>
              <input id="np-name" ref={firstRef} value={form.name} onChange={update('name')} />
              {errors.name && <div className={styles.fieldError}>{errors.name}</div>}
            </div>
            <div className={styles.field}>
              <label htmlFor="np-customer">客户标签 <span style={{ color: 'var(--red)' }}>*</span></label>
              <input id="np-customer" value={form.customerLabel} onChange={update('customerLabel')} placeholder="如：张三@wechat" />
              {errors.customerLabel && <div className={styles.fieldError}>{errors.customerLabel}</div>}
            </div>
            <div className={styles.field}>
              <label htmlFor="np-desc">项目描述 <span style={{ color: 'var(--red)' }}>*</span></label>
              <textarea id="np-desc" value={form.description} onChange={update('description')} />
              {errors.description && <div className={styles.fieldError}>{errors.description}</div>}
            </div>
            <div className={styles.field}>
              <label htmlFor="np-priority">优先级</label>
              <select id="np-priority" value={form.priority} onChange={update('priority')}>
                <option value="normal">普通</option>
                <option value="urgent">紧急</option>
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="np-level">论文级别</label>
              <select id="np-level" value={form.thesisLevel} onChange={update('thesisLevel')}>
                <option value="bachelor">本科</option>
                <option value="master">硕士</option>
                <option value="doctor">博士</option>
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="np-subject">学科</label>
              <input id="np-subject" value={form.subject} onChange={update('subject')} placeholder="可选" />
            </div>
            <div className={styles.field}>
              <label htmlFor="np-deadline">截止日期 <span style={{ color: 'var(--red)' }}>*</span></label>
              <input id="np-deadline" type="date" value={form.deadline} onChange={update('deadline')} />
              {errors.deadline && <div className={styles.fieldError}>{errors.deadline}</div>}
            </div>
            <div className={styles.field}>
              <label htmlFor="np-quote">报价（¥，可选）</label>
              <input id="np-quote" type="number" min="0" step="0.01" value={form.originalQuote} onChange={update('originalQuote')} placeholder="如 5000.00" />
            </div>
            {submitError && <div className={styles.fieldError} role="alert">{submitError}</div>}
          </div>
          <div className={styles.modalFoot}>
            <button type="button" className={styles.btn} onClick={onClose} disabled={submitting}>取消</button>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={submitting}>
              {submitting ? '创建中…' : '创建项目'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
