/**
 * @file NewProjectDialog.tsx
 * @description 新建项目 modal - 含开题书 / 任务书 / 微信聊天记录截图三类资料上传
 *              提交流程：先 POST /api/files 上传所有文件得 fileId → createProject 把 ID 带入
 *              后端事务内 INSERT projects + N 行 project_files (category='wechat_chat')
 *
 * @author Atlas.oi
 * @date 2026-05-01
 */
import { useEffect, useRef, useState, type ChangeEvent, type ReactElement } from 'react';
import { z } from 'zod';
import { DayPicker } from 'react-day-picker';
import { zhCN } from 'date-fns/locale';
import { format } from 'date-fns';
import 'react-day-picker/style.css';
import styles from '../progress.module.css';
import { useProjectsStore } from '../stores/projectsStore';
import { useToastStore } from '../stores/toastStore';
import { uploadFile } from '../api/files';
import type { CreateProjectInput, ProjectPriority, ThesisLevel } from '../api/projects';
import { listUsers } from '../../atlas/api/users';
import type { UserPayload } from '../api/schemas';

interface NewProjectDialogProps {
  onClose: () => void;
  onSuccess?: (id: number) => void;
}

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

/** developer 角色 ID（与后端 services 角色映射一致；subagent B 验证：role=2 dev / role=3 cs / role=1 admin）。
 *  用户原话 2026-05-03"新建项目时应该必须选择当前项目对接的开发人员"——下拉仅显示 dev 角色用户。 */
const DEVELOPER_ROLE_ID = 2;

export function NewProjectDialog({ onClose, onSuccess }: NewProjectDialogProps): ReactElement {
  const create = useProjectsStore((s) => s.create);
  const showToast = useToastStore((s) => s.show);
  const firstRef = useRef<HTMLInputElement | null>(null);
  // 单文件 input ref：用户点 chip × 移除时同步清空 native input.value，让用户可重选同一文件
  const openingInputRef = useRef<HTMLInputElement | null>(null);
  const assignmentInputRef = useRef<HTMLInputElement | null>(null);

  const defaultDeadline = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  })();

  const [form, setForm] = useState({
    name: '',
    customerLabel: '',
    description: '',
    priority: 'normal' as ProjectPriority,
    // 默认本科（用户反馈 2026-05-03"新建项目时论文级别需要默认为本科"，覆盖原 master）
    thesisLevel: 'bachelor' as ThesisLevel,
    subject: '',
    deadline: defaultDeadline,
    originalQuote: '',
  });
  // 三类资料：单文件 = 开题/任务书；多文件 = 微信聊天截图
  const [openingDoc, setOpeningDoc] = useState<File | null>(null);
  const [assignmentDoc, setAssignmentDoc] = useState<File | null>(null);
  const [wechatFiles, setWechatFiles] = useState<File[]>([]);
  // 截止日期 picker 展开状态（react-day-picker 中文，替代 native input[type=date]，因为 macOS WKWebView 不读 <html lang>）
  const [deadlinePickerOpen, setDeadlinePickerOpen] = useState(false);

  // 开发人员候选 + 已选 ID 集合（必选，至少 1 个）
  const [devCandidates, setDevCandidates] = useState<UserPayload[]>([]);
  const [developerUserIds, setDeveloperUserIds] = useState<number[]>([]);
  const [devLoadError, setDevLoadError] = useState<string | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // 提交进度提示：上传文件 → 创建项目
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !submitting) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  // 开发人员候选拉取（已放宽 GET /api/users RBAC，所有登录用户可调）
  useEffect(() => {
    let cancelled = false;
    void listUsers()
      .then((all) => {
        if (cancelled) return;
        const devs = all.filter((u) => u.roleId === DEVELOPER_ROLE_ID && u.isActive);
        setDevCandidates(devs);
      })
      .catch((err) => {
        if (!cancelled) setDevLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, []);

  const toggleDeveloper = (id: number) => {
    setDeveloperUserIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
    if (errors.developerUserIds) {
      const next = { ...errors }; delete next.developerUserIds; setErrors(next);
    }
  };

  const update = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm({ ...form, [k]: e.target.value });
    if (errors[k]) {
      const next = { ...errors }; delete next[k]; setErrors(next);
    }
  };

  const onPickOpening = (e: ChangeEvent<HTMLInputElement>) => {
    setOpeningDoc(e.target.files?.[0] ?? null);
  };
  const onPickAssignment = (e: ChangeEvent<HTMLInputElement>) => {
    setAssignmentDoc(e.target.files?.[0] ?? null);
  };
  const onPickWechat = (e: ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const next = Array.from(e.target.files);
    setWechatFiles((prev) => [...prev, ...next]);
    // input 必须 reset 以允许重复选同一文件
    e.target.value = '';
  };
  const removeWechat = (idx: number) => {
    setWechatFiles((prev) => prev.filter((_, i) => i !== idx));
  };
  const removeOpening = () => {
    setOpeningDoc(null);
    if (openingInputRef.current) openingInputRef.current.value = '';
  };
  const removeAssignment = () => {
    setAssignmentDoc(null);
    if (assignmentInputRef.current) assignmentInputRef.current.value = '';
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
    if (developerUserIds.length === 0) {
      setErrors({ developerUserIds: '请至少选择一个开发人员' });
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      // 第一步：上传所有文件得到 file id（任一失败 → 中止 + 报错；不创建项目）
      let openingId: number | undefined;
      let assignmentId: number | undefined;
      const wechatIds: number[] = [];

      if (openingDoc) {
        setProgress('上传开题书…');
        const meta = await uploadFile(openingDoc);
        openingId = meta.id;
      }
      if (assignmentDoc) {
        setProgress('上传任务书…');
        const meta = await uploadFile(assignmentDoc);
        assignmentId = meta.id;
      }
      for (let i = 0; i < wechatFiles.length; i++) {
        setProgress(`上传微信聊天截图 (${i + 1}/${wechatFiles.length})…`);
        const meta = await uploadFile(wechatFiles[i]);
        wechatIds.push(meta.id);
      }

      // 第二步：创建项目（含上传得到的 fileIds）
      setProgress('创建项目…');
      const isoDeadline = new Date(form.deadline + 'T23:59:59').toISOString();
      const input: CreateProjectInput = {
        name: form.name.trim(),
        customerLabel: form.customerLabel.trim(),
        description: form.description.trim(),
        priority: form.priority,
        thesisLevel: form.thesisLevel,
        deadline: isoDeadline,
        developerUserIds,
      };
      if (form.subject.trim()) input.subject = form.subject.trim();
      if (form.originalQuote.trim()) {
        const n = Number(form.originalQuote);
        if (!Number.isFinite(n) || n < 0) {
          setErrors({ originalQuote: '请输入合法金额' });
          setSubmitting(false);
          setProgress(null);
          return;
        }
        input.originalQuote = n.toFixed(2);
      }
      if (openingId !== undefined) input.openingDocId = openingId;
      if (assignmentId !== undefined) input.assignmentDocId = assignmentId;
      if (wechatIds.length > 0) input.wechatChatFileIds = wechatIds;

      const created = await create(input);
      showToast('项目已创建 · ' + created.name);
      onSuccess?.(created.id);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  };

  return (
    <div className={`${styles.modalOverlay} ${styles.modalOverlayOpen}`} role="dialog" aria-modal="true" aria-labelledby="new-project-title">
      <div className={`${styles.modal} ${styles.modalWide}`}>
        <div className={styles.modalHead}>
          <h3 id="new-project-title">新建项目</h3>
          <button type="button" className={styles.modalClose} aria-label="关闭" onClick={onClose} disabled={submitting}>×</button>
        </div>
        <form onSubmit={submit}>
          <div className={styles.modalBody}>
            <div className={styles.formGrid}>
              {/* 项目名 + 项目描述：全宽 */}
              <div className={`${styles.field} ${styles.formRowFull}`}>
                <label htmlFor="np-name">项目名 <span style={{ color: 'var(--red)' }}>*</span></label>
                <input id="np-name" ref={firstRef} value={form.name} onChange={update('name')} disabled={submitting} />
                {errors.name && <div className={styles.fieldError}>{errors.name}</div>}
              </div>
              <div className={`${styles.field} ${styles.formRowFull}`}>
                <label htmlFor="np-desc">项目描述 <span style={{ color: 'var(--red)' }}>*</span></label>
                <textarea id="np-desc" value={form.description} onChange={update('description')} disabled={submitting} />
                {errors.description && <div className={styles.fieldError}>{errors.description}</div>}
              </div>

              {/* 其它字段：两列 */}
              <div className={styles.field}>
                <label htmlFor="np-customer">客户标签 <span style={{ color: 'var(--red)' }}>*</span></label>
                <input id="np-customer" value={form.customerLabel} onChange={update('customerLabel')} placeholder="如：张三@wechat" disabled={submitting} />
                {errors.customerLabel && <div className={styles.fieldError}>{errors.customerLabel}</div>}
              </div>
              <div className={styles.field}>
                <label htmlFor="np-subject">学科</label>
                <input id="np-subject" value={form.subject} onChange={update('subject')} placeholder="可选" disabled={submitting} />
              </div>
              <div className={styles.field}>
                <label htmlFor="np-priority">优先级</label>
                <select id="np-priority" value={form.priority} onChange={update('priority')} disabled={submitting}>
                  <option value="normal">普通</option>
                  <option value="urgent">紧急</option>
                </select>
              </div>
              <div className={styles.field}>
                <label htmlFor="np-level">论文级别</label>
                <select id="np-level" value={form.thesisLevel} onChange={update('thesisLevel')} disabled={submitting}>
                  <option value="bachelor">本科</option>
                  <option value="master">硕士</option>
                  <option value="doctor">博士</option>
                </select>
              </div>
              <div className={styles.field}>
                <label htmlFor="np-deadline">截止日期 <span style={{ color: 'var(--red)' }}>*</span></label>
                <input
                  id="np-deadline"
                  type="text"
                  readOnly
                  value={form.deadline}
                  placeholder="点击选择日期"
                  onClick={() => !submitting && setDeadlinePickerOpen((o) => !o)}
                  disabled={submitting}
                  style={{ cursor: submitting ? 'not-allowed' : 'pointer' }}
                />
                {deadlinePickerOpen && (
                  <div style={{
                    background: 'var(--c-panel, var(--bg-2))',
                    border: '1px solid var(--c-border, var(--border))',
                    borderRadius: 8,
                    padding: 8,
                    marginTop: 4,
                  }}>
                    <DayPicker
                      mode="single"
                      locale={zhCN}
                      selected={form.deadline ? new Date(form.deadline) : undefined}
                      onSelect={(date) => {
                        if (date) {
                          setForm((prev) => ({ ...prev, deadline: format(date, 'yyyy-MM-dd') }));
                          setDeadlinePickerOpen(false);
                        }
                      }}
                      disabled={{ before: new Date() }}
                    />
                  </div>
                )}
                {errors.deadline && <div className={styles.fieldError}>{errors.deadline}</div>}
              </div>
              <div className={styles.field}>
                <label htmlFor="np-quote">报价（¥，可选）</label>
                <input id="np-quote" type="number" min="0" step="0.01" value={form.originalQuote} onChange={update('originalQuote')} placeholder="如 5000.00" disabled={submitting} />
              </div>

              {/* 对接开发人员（必填，多选）：用户原话 2026-05-03"新建项目时应该必须选择当前项目对接的开发人员"
               *  下拉显示 displayName，roleId === DEVELOPER_ROLE_ID 的用户作候选 */}
              <div className={`${styles.field} ${styles.formRowFull}`}>
                <label>对接开发人员 <span style={{ color: 'var(--red)' }}>*</span></label>
                {devLoadError ? (
                  <div className={styles.fieldError}>开发人员列表加载失败：{devLoadError}</div>
                ) : devCandidates.length === 0 ? (
                  <div style={{ color: 'var(--muted)', fontSize: 12 }}>暂无可选开发人员</div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {devCandidates.map((u) => {
                      const checked = developerUserIds.includes(u.id);
                      const label = u.displayName ?? u.username;
                      return (
                        <label
                          key={u.id}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '4px 10px',
                            border: `1px solid ${checked ? 'var(--accent)' : 'var(--line)'}`,
                            borderRadius: 16,
                            background: checked ? 'rgba(184,255,106,0.10)' : 'transparent',
                            color: checked ? 'var(--accent)' : 'var(--text)',
                            cursor: submitting ? 'not-allowed' : 'pointer',
                            fontSize: 12,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleDeveloper(u.id)}
                            disabled={submitting}
                            style={{ display: 'none' }}
                          />
                          {label}
                        </label>
                      );
                    })}
                  </div>
                )}
                {errors.developerUserIds && <div className={styles.fieldError}>{errors.developerUserIds}</div>}
              </div>

              {/* 资料文件区：全宽 */}
              <div className={`${styles.field} ${styles.formRowFull}`}>
                <label>资料文件（可选，提交时一并上传）</label>
                <div className={styles.docUploadGrid}>
                  <div className={styles.docUploadCell}>
                    <label htmlFor="np-opening">开题书</label>
                    <input
                      id="np-opening"
                      type="file"
                      accept=".pdf,.doc,.docx"
                      onChange={onPickOpening}
                      disabled={submitting}
                      ref={openingInputRef}
                    />
                    {openingDoc && (
                      <div className={styles.docUploadList}>
                        <span className={styles.docUploadChip}>
                          {openingDoc.name}
                          <button type="button" onClick={removeOpening} aria-label={`移除 ${openingDoc.name}`} disabled={submitting}>×</button>
                        </span>
                      </div>
                    )}
                    <div className={styles.docUploadHint}>PDF / Word，单文件</div>
                  </div>
                  <div className={styles.docUploadCell}>
                    <label htmlFor="np-assignment">任务书</label>
                    <input
                      id="np-assignment"
                      type="file"
                      accept=".pdf,.doc,.docx"
                      onChange={onPickAssignment}
                      disabled={submitting}
                      ref={assignmentInputRef}
                    />
                    {assignmentDoc && (
                      <div className={styles.docUploadList}>
                        <span className={styles.docUploadChip}>
                          {assignmentDoc.name}
                          <button type="button" onClick={removeAssignment} aria-label={`移除 ${assignmentDoc.name}`} disabled={submitting}>×</button>
                        </span>
                      </div>
                    )}
                    <div className={styles.docUploadHint}>PDF / Word，单文件</div>
                  </div>
                  <div className={`${styles.docUploadCell} ${styles.docUploadCellWide}`}>
                    <label htmlFor="np-wechat">微信聊天记录截图</label>
                    <input id="np-wechat" type="file" accept="image/*" multiple onChange={onPickWechat} disabled={submitting} />
                    <div className={styles.docUploadHint}>支持多张图片，可分次添加</div>
                    {wechatFiles.length > 0 && (
                      <div className={styles.docUploadList}>
                        {wechatFiles.map((f, idx) => (
                          <span key={`${f.name}-${idx}`} className={styles.docUploadChip}>
                            {f.name}
                            <button type="button" onClick={() => removeWechat(idx)} aria-label={`移除 ${f.name}`} disabled={submitting}>×</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {progress && <div className={styles.docUploadHint} role="status">{progress}</div>}
            {submitError && <div className={styles.fieldError} role="alert">{submitError}</div>}
          </div>
          <div className={styles.modalFoot}>
            <button type="button" className={styles.btn} onClick={onClose} disabled={submitting}>取消</button>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={submitting}>
              {submitting ? '提交中…' : '创建项目'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
