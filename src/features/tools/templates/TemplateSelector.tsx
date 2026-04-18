/**
 * @file TemplateSelector.tsx
 * @description 模板选择器下拉组件。渲染在工具面板顶部，
 *              允许用户切换当前激活的参考文献格式模板。
 *              选择结果通过 toolsStore.setActiveTemplate 同步，
 *              并持久化到 localStorage，下次启动时自动恢复。
 * @author Atlas.oi
 * @date 2026-04-18
 */

import { useEffect } from 'react';
import { useTemplateStore } from './TemplateStore';
import { useToolsStore } from '../toolsStore';

// localStorage 键名，跨会话持久化最后使用的模板 ID
const STORAGE_KEY = 'ghostterm:active-template-id';

// 内置模板兜底 ID，localStorage 中的 ID 在列表中找不到时回退到此值
const DEFAULT_TEMPLATE_ID = '_builtin-gbt7714';

interface TemplateSelectorProps {
  /** Task 9 完成后由 ToolsWorkspace 传入，打开 TemplateManager modal */
  onManage?: () => void;
}

export function TemplateSelector({ onManage }: TemplateSelectorProps) {
  // ?? [] 防御 store 初始化时 templates 可能为 undefined 的极端情况
  const { templates = [], loading, load } = useTemplateStore();
  const { activeTemplateId, setActiveTemplate } = useToolsStore();

  // ============================================
  // 初始化：恢复 localStorage 中保存的模板 ID，并加载模板列表
  // ============================================
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      setActiveTemplate(saved);
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================
  // activeTemplateId 变化时同步写入 localStorage
  // ============================================
  useEffect(() => {
    if (activeTemplateId) {
      localStorage.setItem(STORAGE_KEY, activeTemplateId);
    }
  }, [activeTemplateId]);

  // ============================================
  // 模板列表加载完成后，校验 activeTemplateId 是否仍然存在
  // 若已被删除则回退到内置默认模板，避免显示无效状态
  // ============================================
  useEffect(() => {
    if (templates.length > 0 && !templates.find((t) => t.id === activeTemplateId)) {
      setActiveTemplate(DEFAULT_TEMPLATE_ID);
    }
  }, [templates, activeTemplateId, setActiveTemplate]);

  return (
    <div
      data-testid="template-selector"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        borderBottom: '1px solid var(--c-border)',
        background: 'var(--c-bg)',
        flexShrink: 0,
      }}
    >
      {/* 左侧标签 */}
      <span
        style={{
          fontSize: 12,
          color: 'var(--c-fg-muted)',
          fontFamily: 'var(--font-ui)',
          whiteSpace: 'nowrap',
        }}
      >
        模板：
      </span>

      {/* 模板选择下拉 */}
      {loading ? (
        <span
          style={{
            fontSize: 12,
            color: 'var(--c-fg-muted)',
            fontFamily: 'var(--font-ui)',
          }}
        >
          加载中...
        </span>
      ) : (
        <select
          data-testid="template-select"
          value={activeTemplateId}
          onChange={(e) => setActiveTemplate(e.target.value)}
          style={{
            padding: '4px 8px',
            background: 'var(--c-raised)',
            color: 'var(--c-fg)',
            border: '1px solid var(--c-border)',
            borderRadius: 'var(--r-sm)',
            fontSize: 13,
            fontFamily: 'var(--font-ui)',
            cursor: 'pointer',
          }}
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}

      {/* 右侧"管理模板"按钮，Task 9 完成后通过 onManage 传入回调 */}
      <button
        data-testid="manage-templates-btn"
        onClick={onManage}
        disabled={!onManage}
        style={{
          marginLeft: 'auto',
          padding: '4px 10px',
          fontSize: 12,
          fontFamily: 'var(--font-ui)',
          background: onManage ? 'var(--c-accent)' : 'transparent',
          color: onManage ? 'var(--c-accent-text)' : 'var(--c-fg-muted)',
          border: '1px solid var(--c-border)',
          borderRadius: 'var(--r-sm)',
          cursor: onManage ? 'pointer' : 'not-allowed',
          whiteSpace: 'nowrap',
        }}
      >
        管理模板
      </button>
    </div>
  );
}
