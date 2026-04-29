/**
 * @file ProjectEventTrigger.tsx
 * @description 项目状态机事件触发按钮（基础占位 / Phase 5 Worker B）。
 *
 *              业务背景：
 *              - 本组件仅做"调用 store.triggerEvent + 显示 loading"的最小骨架
 *              - Phase 11 (EventActionButtons + EventTriggerDialog) 会完整化：
 *                · 按当前 status + 角色筛选可触发事件
 *                · I2 focus trap 弹窗
 *                · remark / newHolderUserId 表单
 *
 *              当前 v1：按钮 + 简单确认（remark 用 prompt() 取）；
 *              足够 dev / smoke test 走完状态机全流程。
 *
 * @author Atlas.oi
 * @date 2026-04-29
 */

import { useState, type ReactElement } from 'react';

import type { EventCode } from '../api/projects';
import { useProjectsStore } from '../stores/projectsStore';

interface ProjectEventTriggerProps {
  projectId: number;
  event: EventCode;
  /** 可见 label 文本 */
  label: string;
  /** 可选：触发事件时附带的 newHolderUserId（如客服指定 dev） */
  newHolderUserId?: number;
  /** 触发成功后的回调（caller 决定是否 toast / refresh） */
  onSuccess?: () => void;
}

/**
 * 单个事件触发按钮。
 *
 * 业务流程：
 * 1. 用户点击 → prompt 备注（v1 极简交互；Phase 11 改弹窗）
 * 2. 调 store.triggerEvent
 * 3. 成功 → onSuccess()
 * 4. 失败 → setError + alert（Phase 11 改 Toast）
 */
export function ProjectEventTrigger({
  projectId,
  event,
  label,
  newHolderUserId,
  onSuccess,
}: ProjectEventTriggerProps): ReactElement {
  const triggerEvent = useProjectsStore((s) => s.triggerEvent);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    // 业务规则：spec §6.2 大多数事件 remark 必填
    const remark = window.prompt(`请输入 ${label} 的备注：`);
    if (!remark || !remark.trim()) {
      // 用户取消 / 空备注：不触发
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await triggerEvent(projectId, {
        event,
        remark: remark.trim(),
        newHolderUserId: newHolderUserId ?? null,
      });
      onSuccess?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <span>
      <button
        type="button"
        onClick={handleClick}
        disabled={submitting}
        data-testid={`event-trigger-${event}`}
      >
        {submitting ? '处理中...' : label}
      </button>
      {error && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
    </span>
  );
}
