/**
 * @file CustomerEditDialog.tsx
 * @description 项目内客户编辑对话框（Phase 4 - Worker A）。
 *
 *              使用场景：
 *              - 项目详情页 (Phase 11) 内嵌使用：编辑某项目关联客户的 nameWechat / remark
 *              - 也可独立使用：传 projectCustomer = null 表示"新建客户"模式
 *
 *              业务行为：
 *              - 传入 projectCustomer 为现有客户 → 编辑模式；保存调 customersStore.update
 *              - 传入 null → 新建模式；保存调 customersStore.create
 *              - 保存按钮被 PermissionGate(perm="customer:write") 包裹：
 *                无权用户看不到按钮（UI 自然降级；后端 RLS 仍是终审）
 *                注：customer:write 由 customer:create + customer:update 二者任一兜底，
 *                这里用 "customer:create" 作为最严格的"能写操作"代表
 *              - 保存成功后调 onSave(customer)；失败时 onError(message) 不关闭弹窗
 *
 *              UI/UX 取舍：
 *              - 受控输入：name/remark 用 useState 暂存草稿，避免每次打字都触发 store 更新
 *              - "切换被编辑对象的 modal 必须用 key remount"（user 偏好：feedback_modal_editor_needs_key_per_item）
 *                调用方应通过 key={projectCustomer?.id ?? 'new'} 让本组件 remount
 *                否则 useState lazy init 不会重跑，draft 残留旧 customer 数据
 *              - inline style 用 CSS 变量（user 偏好：feedback_dialog_css_vars），不写硬编码颜色
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { useState } from 'react';
import type { ChangeEvent } from 'react';

import { useCustomersStore } from '../stores/customersStore';
import { PermissionGate } from './PermissionGate';
import type { CustomerPayload } from '../api/schemas';

interface CustomerEditDialogProps {
  /**
   * 待编辑客户；null 表示"新建"模式。
   *
   * 切换该 prop 时调用方必须用 key 让组件 remount，否则 draft state 不会重新初始化。
   */
  projectCustomer: CustomerPayload | null;

  /** 保存成功后的回调（编辑模式 = 已更新；新建模式 = 已创建） */
  onSave: (customer: CustomerPayload) => void;

  /** 取消按钮回调（默认 = 用户主动关闭弹窗） */
  onCancel: () => void;

  /** 保存失败时的回调；不传则错误仅落入 store.error */
  onError?: (message: string) => void;
}

/**
 * 客户编辑/新建对话框。
 *
 * 业务流程：
 *  1. 用 useState 初始化草稿（基于 projectCustomer 现有值或空）
 *  2. 用户输入 → setDraft 更新本地 state（不触碰 store）
 *  3. 点击保存 → 校验 nameWechat 非空 → 调 store.create / update
 *     - 编辑模式：UpdateCustomerInput；只在字段真的变了时传，避免无意义的 PATCH
 *     - 新建模式：CreateCustomerInput
 *  4. 成功 → onSave；失败 → onError + 保留弹窗
 */
export function CustomerEditDialog({
  projectCustomer,
  onSave,
  onCancel,
  onError,
}: CustomerEditDialogProps) {
  const isEditMode = projectCustomer !== null;
  const createCustomer = useCustomersStore((s) => s.create);
  const updateCustomer = useCustomersStore((s) => s.update);

  // ============================================
  // 草稿 state（受控输入）
  // useState 仅在首次渲染初始化；切换 projectCustomer 必须靠 key remount
  // ============================================
  const [nameWechat, setNameWechat] = useState<string>(
    projectCustomer?.nameWechat ?? '',
  );
  const [remark, setRemark] = useState<string>(projectCustomer?.remark ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleNameChange = (e: ChangeEvent<HTMLInputElement>) => {
    setNameWechat(e.target.value);
    if (validationError) setValidationError(null);
  };

  const handleRemarkChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setRemark(e.target.value);
  };

  const handleSave = async () => {
    // 业务校验：nameWechat 不能为空
    const trimmedName = nameWechat.trim();
    if (trimmedName === '') {
      setValidationError('客户名称不能为空');
      return;
    }
    setSubmitting(true);
    setValidationError(null);
    try {
      let result: CustomerPayload;
      if (isEditMode && projectCustomer) {
        // 业务流程（更新）：仅传变化的字段，避免无意义 PATCH
        const patch: { nameWechat?: string; remark?: string | null } = {};
        if (trimmedName !== projectCustomer.nameWechat) {
          patch.nameWechat = trimmedName;
        }
        // remark 三态：原 null + draft '' = "保持空"（不发字段）
        // 原 null + draft 非空 = 设值；原值 + draft '' = 显式清空 → null
        const oldRemark = projectCustomer.remark;
        const newRemark = remark.trim();
        if (newRemark === '' && oldRemark !== null) {
          patch.remark = null; // 显式清空
        } else if (newRemark !== '' && newRemark !== (oldRemark ?? '')) {
          patch.remark = newRemark;
        }
        result = await updateCustomer(projectCustomer.id, patch);
      } else {
        // 业务流程（新建）：构造 CreateCustomerInput
        const input: { nameWechat: string; remark?: string } = {
          nameWechat: trimmedName,
        };
        const trimmedRemark = remark.trim();
        if (trimmedRemark !== '') {
          input.remark = trimmedRemark;
        }
        result = await createCustomer(input);
      }
      onSave(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onError?.(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label={isEditMode ? '编辑客户' : '新建客户'}
      data-testid="customer-edit-dialog"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 16,
        background: 'var(--c-panel)',
        color: 'var(--c-text)',
        border: '1px solid var(--c-border)',
        borderRadius: 8,
        minWidth: 320,
      }}
    >
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
        {isEditMode ? '编辑客户' : '新建客户'}
      </h3>

      {/* 客户名 / 微信名 */}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>
          客户名 / 微信名 <span style={{ color: 'var(--c-danger)' }}>*</span>
        </span>
        <input
          data-testid="customer-name-input"
          type="text"
          value={nameWechat}
          onChange={handleNameChange}
          placeholder="例如：张三 / 张三@wx"
          disabled={submitting}
          style={{
            padding: '6px 8px',
            background: 'var(--c-bg)',
            color: 'var(--c-text)',
            border: '1px solid var(--c-border)',
            borderRadius: 4,
            fontSize: 13,
          }}
        />
      </label>

      {/* 备注 */}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>备注</span>
        <textarea
          data-testid="customer-remark-input"
          value={remark}
          onChange={handleRemarkChange}
          placeholder="可选：联系偏好、客户特征等"
          disabled={submitting}
          rows={3}
          style={{
            padding: '6px 8px',
            background: 'var(--c-bg)',
            color: 'var(--c-text)',
            border: '1px solid var(--c-border)',
            borderRadius: 4,
            fontSize: 13,
            resize: 'vertical',
          }}
        />
      </label>

      {/* 校验错误展示 */}
      {validationError && (
        <div
          data-testid="customer-validation-error"
          role="alert"
          style={{ fontSize: 12, color: 'var(--c-danger)' }}
        >
          {validationError}
        </div>
      )}

      {/* 操作按钮 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          data-testid="customer-cancel-btn"
          style={{
            padding: '6px 12px',
            background: 'transparent',
            color: 'var(--c-text)',
            border: '1px solid var(--c-border)',
            borderRadius: 4,
            cursor: submitting ? 'not-allowed' : 'pointer',
            fontSize: 13,
          }}
        >
          取消
        </button>
        <PermissionGate
          // 编辑模式用 customer:update；新建模式用 customer:create
          perm={isEditMode ? 'customer:update' : 'customer:create'}
        >
          <button
            type="button"
            onClick={handleSave}
            disabled={submitting}
            data-testid="customer-save-btn"
            style={{
              padding: '6px 12px',
              background: 'var(--c-accent)',
              color: 'var(--c-accent-fg)',
              border: '1px solid var(--c-accent)',
              borderRadius: 4,
              cursor: submitting ? 'not-allowed' : 'pointer',
              fontSize: 13,
            }}
          >
            {submitting ? '保存中…' : '保存'}
          </button>
        </PermissionGate>
      </div>
    </div>
  );
}
