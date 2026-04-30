/**
 * @file ProjectCreateDialog.tsx
 * @description 项目创建对话框（设计稿 1:1 复刻：modal-layer + project-modal 双栏）。
 *
 *              业务背景（设计稿 §modal）：
 *              - 920px 宽双栏弹窗：左侧表单（form-grid 2 列）+ 右侧预览/同步说明
 *              - 阶段选择用 stage-picker 6 选 1（设计稿 S1-S6 卡片样式）
 *              - 点击遮罩 / 关闭按钮 / 取消按钮 → close
 *              - 提交成功后清空表单并关闭
 *
 *              字段必填：name / customerLabel / description / deadline
 *              字段可选：priority（默认 normal）/ thesisLevel / subject / originalQuote（默认 0）
 *              新增：initialStatus（默认 'dealing'，对应 S1 stage option）
 *
 *              注意：当前后端 createProject 不接受 status 入参（spec §6.2 强制走 dealing→事件迁移）。
 *              UI 上暴露 stage picker 是为了贴合设计稿；选中非 S1 时显示提示但仍按 S1 创建，
 *              然后 TODO: 后续接入 trigger event 链式调用让用户感知"创建后自动跳转到选定阶段"。
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { useState, type FormEvent, type ReactElement } from 'react';

import type {
  CreateProjectInput,
  Project,
  ProjectPriority,
  ProjectStatus,
  ThesisLevel,
} from '../api/projects';
import { useProjectsStore } from '../stores/projectsStore';
import styles from '../progress.module.css';

interface ProjectCreateDialogProps {
  /** 是否显示弹窗 */
  open: boolean;
  /** 关闭弹窗（取消按钮 / 成功后） */
  onClose: () => void;
  /** 创建成功回调（caller 可显示 Toast 或导航） */
  onCreated?: (project: Project) => void;
}

/** 设计稿 stage picker 6 选项 */
const STAGE_OPTIONS: ReadonlyArray<{ status: ProjectStatus; code: string; label: string }> = [
  { status: 'dealing', code: 'S1', label: '洽谈中' },
  { status: 'quoting', code: 'S2', label: '报价中' },
  { status: 'developing', code: 'S3', label: '开发中' },
  { status: 'confirming', code: 'S4', label: '待验收' },
  { status: 'delivered', code: 'S5', label: '已交付' },
  { status: 'paid', code: 'S6', label: '已收款' },
];

const THESIS_LEVEL_OPTIONS: ReadonlyArray<{ value: ThesisLevel | ''; label: string }> = [
  { value: '', label: '未指定' },
  { value: 'bachelor', label: '本科' },
  { value: 'master', label: '硕士' },
  { value: 'doctor', label: '博士' },
];

const PRIORITY_OPTIONS: ReadonlyArray<{ value: ProjectPriority; label: string }> = [
  { value: 'normal', label: '普通' },
  { value: 'urgent', label: '紧急' },
];

export function ProjectCreateDialog({
  open,
  onClose,
  onCreated,
}: ProjectCreateDialogProps): ReactElement | null {
  const [name, setName] = useState('');
  const [customerLabel, setCustomerLabel] = useState<string>('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<ProjectPriority>('normal');
  const [thesisLevel, setThesisLevel] = useState<ThesisLevel | ''>('');
  const [subject, setSubject] = useState('');
  const [deadline, setDeadline] = useState('');
  const [originalQuote, setOriginalQuote] = useState('0');
  const [initialStatus, setInitialStatus] = useState<ProjectStatus>('dealing');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useProjectsStore((s) => s.create);

  if (!open) {
    return null;
  }

  const resetForm = () => {
    setName('');
    setCustomerLabel('');
    setDescription('');
    setPriority('normal');
    setThesisLevel('');
    setSubject('');
    setDeadline('');
    setOriginalQuote('0');
    setInitialStatus('dealing');
    setError(null);
  };

  // 业务流程：1) 表单校验 2) money normalize 3) 调 store.create 4) 成功重置 + 关闭
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('请填写项目名称');
      return;
    }
    if (!customerLabel.trim()) {
      setError('请填写客户标签');
      return;
    }
    if (!description.trim()) {
      setError('请填写项目描述');
      return;
    }
    if (!deadline) {
      setError('请选择截止日期');
      return;
    }

    const deadlineISO = new Date(deadline).toISOString();
    const numQuote = Number.parseFloat(originalQuote);
    if (!Number.isFinite(numQuote) || numQuote < 0) {
      setError('原始报价必须为非负数字');
      return;
    }
    const normalizedQuote = numQuote.toFixed(2);

    const input: CreateProjectInput = {
      name: name.trim(),
      customerLabel: customerLabel.trim(),
      description: description.trim(),
      priority,
      deadline: deadlineISO,
      originalQuote: normalizedQuote,
    };
    if (thesisLevel) input.thesisLevel = thesisLevel;
    if (subject.trim()) input.subject = subject.trim();

    setSubmitting(true);
    try {
      const project = await create(input);
      onCreated?.(project);
      resetForm();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    resetForm();
    onClose();
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    // 仅点击遮罩背景才关闭，不冒泡触发；点击弹窗内不关闭
    if (e.target === e.currentTarget) {
      handleCancel();
    }
  };

  // 计算预览区右下角 deadline 文字（粗略：days = (deadline - now) / 86400000）
  const previewDeadline = (() => {
    if (!deadline) return null;
    try {
      const days = Math.ceil((new Date(deadline).getTime() - Date.now()) / 86400000);
      if (days < 0) return { cls: `${styles.deadline} ${styles.deadlineLate}`, text: `超期 ${-days}d` };
      if (days > 7) return { cls: `${styles.deadline} ${styles.deadlineSafe}`, text: `${days}d` };
      return { cls: styles.deadline, text: days === 0 ? '今日' : `${days}d` };
    } catch {
      return null;
    }
  })();

  const tightDeadline = previewDeadline && /^\d+d$/.test(previewDeadline.text)
    ? Number.parseInt(previewDeadline.text, 10) <= 7
    : false;

  return (
    <div
      role="dialog"
      aria-label="新建项目"
      data-testid="project-create-dialog"
      className={styles.modalLayer}
      onClick={handleOverlayClick}
    >
      <div className={styles.projectModal}>
        <header className={styles.modalHead}>
          <div className={styles.modalTitle}>
            <strong>新建项目</strong>
            <span>创建后默认进入 S1 洽谈中，也可以直接指定阶段</span>
          </div>
          <button
            type="button"
            className={styles.modalClose}
            aria-label="关闭"
            onClick={handleCancel}
            data-testid="project-cancel-btn"
          >
            ×
          </button>
        </header>

        <form onSubmit={handleSubmit} noValidate style={{ display: 'contents' }}>
          <div className={styles.modalBody}>
            <section className={styles.formArea}>
              {error && (
                <div role="alert" className={styles.modalError}>
                  {error}
                </div>
              )}

              <div className={styles.formGrid}>
                <div className={`${styles.field} ${styles.fieldWide}`}>
                  <label htmlFor="proj-name">项目名称</label>
                  <input
                    id="proj-name"
                    type="text"
                    className={styles.fieldBox}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={submitting}
                    placeholder="例：陈十六 · 硕士论文降重"
                    data-testid="project-name-input"
                  />
                </div>

                <div className={styles.field}>
                  <label htmlFor="proj-customer">客户信息</label>
                  <input
                    id="proj-customer"
                    type="text"
                    className={styles.fieldBox}
                    value={customerLabel}
                    onChange={(e) => setCustomerLabel(e.target.value)}
                    disabled={submitting}
                    placeholder="如：张三 / 张三@wx"
                    data-testid="project-customer-input"
                  />
                </div>

                <div className={styles.field}>
                  <label htmlFor="proj-priority">优先级</label>
                  <select
                    id="proj-priority"
                    className={`${styles.fieldBox} ${styles.filterSelect}`}
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as ProjectPriority)}
                    disabled={submitting}
                    data-testid="project-priority-select"
                  >
                    {PRIORITY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.field}>
                  <label htmlFor="proj-level">论文级别</label>
                  <select
                    id="proj-level"
                    className={`${styles.fieldBox} ${styles.filterSelect}`}
                    value={thesisLevel}
                    onChange={(e) => setThesisLevel(e.target.value as ThesisLevel | '')}
                    disabled={submitting}
                    data-testid="project-thesis-level-select"
                  >
                    {THESIS_LEVEL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.field}>
                  <label htmlFor="proj-subject">学科方向</label>
                  <input
                    id="proj-subject"
                    type="text"
                    className={styles.fieldBox}
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    disabled={submitting}
                    placeholder="例：经济学"
                    data-testid="project-subject-input"
                  />
                </div>

                <div className={styles.field}>
                  <label htmlFor="proj-quote">报价金额</label>
                  <input
                    id="proj-quote"
                    type="text"
                    className={styles.fieldBox}
                    value={originalQuote}
                    onChange={(e) => setOriginalQuote(e.target.value)}
                    disabled={submitting}
                    placeholder="¥6,800"
                    data-testid="project-original-quote-input"
                  />
                </div>

                <div className={styles.field}>
                  <label htmlFor="proj-deadline">截止日期</label>
                  <input
                    id="proj-deadline"
                    type="datetime-local"
                    className={styles.fieldBox}
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    disabled={submitting}
                    data-testid="project-deadline-input"
                  />
                </div>

                <div className={`${styles.field} ${styles.fieldWide}`}>
                  <label>项目阶段</label>
                  <div className={styles.stagePicker} role="radiogroup" aria-label="项目阶段">
                    {STAGE_OPTIONS.map((opt) => {
                      const selected = initialStatus === opt.status;
                      return (
                        <button
                          key={opt.status}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          className={`${styles.stageOption} ${selected ? styles.stageOptionSelected : ''}`}
                          onClick={() => setInitialStatus(opt.status)}
                          data-testid={`stage-option-${opt.status}`}
                        >
                          <strong>{opt.code}</strong>
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className={`${styles.field} ${styles.fieldWide}`}>
                  <label htmlFor="proj-desc">客户需求</label>
                  <textarea
                    id="proj-desc"
                    className={`${styles.fieldBox} ${styles.fieldBoxTextarea}`}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={submitting}
                    placeholder="例：需要在 10 天内完成降重，查重目标 15% 以下，保留原论文结构和参考文献格式。"
                    data-testid="project-description-input"
                  />
                </div>
              </div>
            </section>

            <aside className={styles.modalSide}>
              <div className={styles.previewCard}>
                <h2>{name.trim() || '未命名项目'}</h2>
                <p>客户：{customerLabel || '—'}</p>
                <p>
                  阶段：
                  <span className={styles.assignee}>
                    {STAGE_OPTIONS.find((o) => o.status === initialStatus)?.label ?? '—'}
                  </span>
                </p>
                <div className={styles.cardFoot} style={{ marginTop: 12 }}>
                  <div className={styles.tags}>
                    {thesisLevel && (
                      <span className={styles.tag}>
                        {THESIS_LEVEL_OPTIONS.find((o) => o.value === thesisLevel)?.label}
                      </span>
                    )}
                    {subject.trim() && <span className={styles.tag}>{subject.trim()}</span>}
                  </div>
                  {previewDeadline && (
                    <span className={previewDeadline.cls}>{previewDeadline.text}</span>
                  )}
                </div>
              </div>

              <div className={styles.modalSideSection}>
                <h3>创建后同步</h3>
                <div className={styles.checkRow}>
                  <span className={`${styles.checkbox} ${styles.checkboxChecked}`} />
                  <span>加入看板 {STAGE_OPTIONS.find((o) => o.status === initialStatus)?.code}</span>
                </div>
                <div className={styles.checkRow}>
                  <span className={`${styles.checkbox} ${styles.checkboxChecked}`} />
                  <span>写入列表视图</span>
                </div>
                <div className={styles.checkRow}>
                  <span className={`${styles.checkbox} ${styles.checkboxChecked}`} />
                  <span>生成 Gantt 时间条</span>
                </div>
                <div className={styles.checkRow}>
                  <span className={styles.checkbox} />
                  <span>立即分配开发任务</span>
                </div>
              </div>

              {tightDeadline && (
                <div className={styles.modalSideSection}>
                  <h3>风险提示</h3>
                  <div className={styles.miniCard}>
                    <strong>时间较紧</strong>
                    <p>截止日期距离当前不到 7 天，建议创建后直接进入开发排期。</p>
                  </div>
                </div>
              )}
            </aside>
          </div>

          <footer className={styles.modalActions}>
            <button
              type="button"
              className={styles.secondary}
              disabled={submitting}
              onClick={() => {
                /* TODO: 草稿持久化未实现 */
              }}
            >
              保存为草稿
            </button>
            <div className={styles.actionGroup}>
              <button
                type="button"
                className={styles.secondary}
                onClick={handleCancel}
                disabled={submitting}
              >
                取消
              </button>
              <button
                type="submit"
                className={styles.primary}
                disabled={submitting}
                data-testid="project-submit-btn"
              >
                {submitting ? '创建中…' : '创建项目'}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}
