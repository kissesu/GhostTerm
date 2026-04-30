/**
 * @file ProjectCreateDialog.tsx
 * @description 项目创建对话框 —— 受控表单：客户/名称/描述/截止日期/优先级/论文级别/原始报价。
 *
 *              业务背景：
 *              - 仅 admin / cs 调用此组件（PermissionGate 由调用方负责）
 *              - 提交后调 projectsStore.create；成功后关闭对话框 + onCreated 回调
 *              - 失败显示 Toast（调用方提供）；store 自身不存 error
 *
 *              字段必填：name / customerId / description / deadline
 *              字段可选：priority（默认 normal）/ thesisLevel / subject / originalQuote（默认 0）
 *
 *              注：customer 列表由 Worker A (customer phase) 提供 store；当前组件
 *              暴露 customerId 字段，由调用方透传或通过下拉选择 —— v1 简化：
 *              用户直接输入 customerId（数字）。Phase 11 完整化后改为下拉。
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { useEffect, useState, type FormEvent, type ReactElement } from 'react';

import type {
  CreateProjectInput,
  Project,
  ProjectPriority,
  ThesisLevel,
} from '../api/projects';
import { useProjectsStore } from '../stores/projectsStore';
import { useCustomersStore } from '../stores/customersStore';

interface ProjectCreateDialogProps {
  /** 是否显示弹窗 */
  open: boolean;
  /** 关闭弹窗（取消按钮 / 成功后） */
  onClose: () => void;
  /** 创建成功回调（caller 可显示 Toast 或导航） */
  onCreated?: (project: Project) => void;
}

/**
 * 项目创建对话框组件。
 *
 * 业务流程：
 * 1. 用户填写 name / customerId / description / deadline 等字段
 * 2. 点击"创建"调 projectsStore.create
 * 3. 成功 → onCreated(project) + onClose()
 * 4. 失败 → setError 显示在表单顶部
 */
export function ProjectCreateDialog({
  open,
  onClose,
  onCreated,
}: ProjectCreateDialogProps): ReactElement | null {
  // 受控表单 state
  const [name, setName] = useState('');
  const [customerId, setCustomerId] = useState<string>(''); // 字符串以便受控 input；提交时 parseInt
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<ProjectPriority>('normal');
  const [thesisLevel, setThesisLevel] = useState<ThesisLevel | ''>('');
  const [subject, setSubject] = useState('');
  const [deadline, setDeadline] = useState(''); // datetime-local
  const [originalQuote, setOriginalQuote] = useState('0');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useProjectsStore((s) => s.create);
  const customers = useCustomersStore((s) => s.customers);
  const fetchCustomers = useCustomersStore((s) => s.fetchAll);

  // 打开时拉一次客户列表（已拉过则 store 已有缓存，再次拉只是 noop 网络请求）
  useEffect(() => {
    if (open) {
      fetchCustomers().catch(() => {
        // 错误进 store.error，UI 自行展示
      });
    }
  }, [open, fetchCustomers]);

  if (!open) {
    return null;
  }

  // 提交处理
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    // 表单校验：必填
    if (!name.trim()) {
      setError('请填写项目名称');
      return;
    }
    const customerIdNum = Number.parseInt(customerId, 10);
    if (!Number.isFinite(customerIdNum) || customerIdNum <= 0) {
      setError('请填写有效的客户 ID');
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

    // datetime-local 不带时区；转为 ISO 8601（按用户当地时区解释）
    const deadlineISO = new Date(deadline).toISOString();

    // OpenAPI Money pattern 要求 ^-?\d+\.\d{2}$（必须 2 位小数）；前端用户输入可能是 "5000" / "5000.5"
    // 这里 normalize：parse 浮点 → toFixed(2) → 字符串。3 位+ 小数会被截断（精度丢失警告由 Money 类型在 server 兜底）
    const numQuote = Number.parseFloat(originalQuote);
    if (!Number.isFinite(numQuote) || numQuote < 0) {
      setError('原始报价必须为非负数字');
      return;
    }
    const normalizedQuote = numQuote.toFixed(2);

    const input: CreateProjectInput = {
      name: name.trim(),
      customerId: customerIdNum,
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
      // 成功后重置表单 + 关闭
      resetForm();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setName('');
    setCustomerId('');
    setDescription('');
    setPriority('normal');
    setThesisLevel('');
    setSubject('');
    setDeadline('');
    setOriginalQuote('0');
    setError(null);
  };

  return (
    <div role="dialog" aria-label="新建项目" data-testid="project-create-dialog">
      <h2>新建项目</h2>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {/* 业务背景：noValidate 禁用 HTML5 自动校验，由 JS 在 handleSubmit 内统一校验，
          避免浏览器拦截后 onSubmit 不触发导致 setError 失效（前端规则：错误必须暴露给用户） */}
      <form onSubmit={handleSubmit} noValidate>
        <label>
          项目名称
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={submitting}
            data-testid="project-name-input"
          />
        </label>

        <label>
          客户
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            disabled={submitting}
            data-testid="project-customer-input"
          >
            <option value="">请选择客户</option>
            {customers.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.nameWechat}
                {c.remark ? `（${c.remark}）` : ''}
              </option>
            ))}
          </select>
          {customers.length === 0 && (
            <span style={{ fontSize: 12, color: 'var(--c-fg-muted)', display: 'block', marginTop: 4 }}>
              暂无客户，请先点工具栏"新建客户"创建
            </span>
          )}
        </label>

        <label>
          描述
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={submitting}
            data-testid="project-description-input"
          />
        </label>

        <label>
          截止日期
          <input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            disabled={submitting}
            data-testid="project-deadline-input"
          />
        </label>

        <label>
          优先级
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as ProjectPriority)}
            disabled={submitting}
            data-testid="project-priority-select"
          >
            <option value="normal">普通</option>
            <option value="urgent">紧急</option>
          </select>
        </label>

        <label>
          论文等级
          <select
            value={thesisLevel}
            onChange={(e) => setThesisLevel(e.target.value as ThesisLevel | '')}
            disabled={submitting}
            data-testid="project-thesis-level-select"
          >
            <option value="">未指定</option>
            <option value="bachelor">本科</option>
            <option value="master">硕士</option>
            <option value="doctor">博士</option>
          </select>
        </label>

        <label>
          学科 / 选题
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={submitting}
            data-testid="project-subject-input"
          />
        </label>

        <label>
          原始报价（元）
          <input
            type="text"
            value={originalQuote}
            onChange={(e) => setOriginalQuote(e.target.value)}
            disabled={submitting}
            data-testid="project-original-quote-input"
          />
        </label>

        <div className="actions">
          <button
            type="button"
            onClick={() => {
              resetForm();
              onClose();
            }}
            disabled={submitting}
            data-testid="project-cancel-btn"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting}
            data-testid="project-submit-btn"
          >
            {submitting ? '创建中...' : '创建'}
          </button>
        </div>
      </form>
    </div>
  );
}
