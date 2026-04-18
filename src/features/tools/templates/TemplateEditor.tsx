/**
 * @file TemplateEditor.tsx
 * @description 单模板表格编辑视图。每行一条规则：enabled 开关 + 值编辑器。
 *   保存时调用 onSave(draft)，不直接操作 store（由调用方决定持久化方式）。
 * @author Atlas.oi
 * @date 2026-04-18
 */

import { useState } from 'react';
import type { TemplateJson } from './TemplateStore';
import { RULE_SCHEMAS } from './ruleSchemas';
import { RuleValueEditor } from './RuleValueEditor';

interface Props {
  template: TemplateJson;
  onSave: (updated: TemplateJson) => Promise<void>;
  onCancel: () => void;
}

export function TemplateEditor({ template, onSave, onCancel }: Props) {
  // draft 仅含 rules，保存时与原模板 merge
  const [draft, setDraft] = useState<TemplateJson>(() => ({
    ...template,
    // 深拷贝 rules，避免直接修改 store 内对象
    rules: JSON.parse(JSON.stringify(template.rules)) as TemplateJson['rules'],
  }));
  const [saving, setSaving] = useState(false);

  // ============================================
  // 处理 enabled 开关变化
  // ============================================
  const handleEnabledChange = (ruleId: string, enabled: boolean) => {
    setDraft((prev) => ({
      ...prev,
      rules: {
        ...prev.rules,
        [ruleId]: { ...prev.rules[ruleId], enabled },
      },
    }));
  };

  // ============================================
  // 处理 value 变化（由 RuleValueEditor 上报）
  // ============================================
  const handleValueChange = (ruleId: string, value: unknown) => {
    setDraft((prev) => ({
      ...prev,
      rules: {
        ...prev.rules,
        [ruleId]: { ...prev.rules[ruleId], value },
      },
    }));
  };

  // ============================================
  // 保存：调用上层 onSave 回调，上层负责 invoke + reload
  // ============================================
  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  };

  // 按 RULE_SCHEMAS 顺序渲染，有 schema 定义的规则才渲染；
  // 模板 rules 中有 schema 对应项的才显示（避免旧版模板中未知规则乱入）
  const ruleIds = Object.keys(RULE_SCHEMAS).filter((id) => id in draft.rules);

  return (
    <div
      data-testid="template-editor"
      style={{ display: 'flex', flexDirection: 'column', gap: 0, minHeight: 0, flex: 1 }}
    >
      {/* 标题行 */}
      <div
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--c-border)',
          fontSize: 14,
          fontWeight: 600,
          fontFamily: 'var(--font-ui)',
          color: 'var(--c-fg)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <button
          data-testid="editor-back-btn"
          onClick={onCancel}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--c-fg-muted)',
            fontSize: 16,
            padding: '0 4px',
            lineHeight: 1,
          }}
          aria-label="返回"
        >
          {'<'}
        </button>
        <span>编辑模板：{draft.name}</span>
      </div>

      {/* 规则表格 */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <table
          data-testid="rules-table"
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 13,
            fontFamily: 'var(--font-ui)',
          }}
        >
          <thead>
            <tr style={{ background: 'var(--c-raised)', borderBottom: '1px solid var(--c-border)' }}>
              <th style={{ textAlign: 'left', padding: '7px 16px', fontWeight: 500, color: 'var(--c-fg-muted)', width: 140 }}>规则</th>
              <th style={{ textAlign: 'center', padding: '7px 8px', fontWeight: 500, color: 'var(--c-fg-muted)', width: 60 }}>启用</th>
              <th style={{ textAlign: 'left', padding: '7px 16px', fontWeight: 500, color: 'var(--c-fg-muted)' }}>参数值</th>
            </tr>
          </thead>
          <tbody>
            {ruleIds.map((ruleId, idx) => {
              const schema = RULE_SCHEMAS[ruleId];
              const rule = draft.rules[ruleId];
              return (
                <tr
                  key={ruleId}
                  data-testid={`rule-row-${ruleId}`}
                  style={{
                    borderBottom: '1px solid var(--c-border)',
                    background: idx % 2 === 0 ? 'transparent' : 'var(--c-raised)',
                  }}
                >
                  <td style={{ padding: '8px 16px', color: 'var(--c-fg)', verticalAlign: 'middle' }}>
                    {schema.label}
                    <div style={{ fontSize: 10, color: 'var(--c-fg-muted)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>
                      {ruleId}
                    </div>
                  </td>
                  <td style={{ textAlign: 'center', padding: '8px 8px', verticalAlign: 'middle' }}>
                    <input
                      data-testid={`rule-enabled-${ruleId}`}
                      type="checkbox"
                      checked={rule?.enabled ?? false}
                      onChange={(e) => handleEnabledChange(ruleId, e.target.checked)}
                    />
                  </td>
                  <td style={{ padding: '8px 16px', verticalAlign: 'middle' }}>
                    <RuleValueEditor
                      shape={schema.valueShape}
                      value={rule?.value}
                      onChange={(next) => handleValueChange(ruleId, next)}
                    />
                  </td>
                </tr>
              );
            })}
            {ruleIds.length === 0 && (
              <tr>
                <td colSpan={3} style={{ padding: 24, textAlign: 'center', color: 'var(--c-fg-muted)', fontSize: 13 }}>
                  此模板暂无可编辑规则
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 底部操作栏 */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
          padding: '10px 16px',
          borderTop: '1px solid var(--c-border)',
          flexShrink: 0,
        }}
      >
        <button
          data-testid="editor-cancel-btn"
          onClick={onCancel}
          disabled={saving}
          style={{
            padding: '7px 16px',
            background: 'var(--c-raised)',
            color: 'var(--c-fg)',
            border: '1px solid var(--c-border)',
            borderRadius: 'var(--r-sm)',
            fontSize: 13,
            fontFamily: 'var(--font-ui)',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          取消
        </button>
        <button
          data-testid="editor-save-btn"
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '7px 16px',
            background: 'var(--c-accent)',
            color: 'var(--c-accent-text)',
            border: 'none',
            borderRadius: 'var(--r-sm)',
            fontSize: 13,
            fontFamily: 'var(--font-ui)',
            fontWeight: 500,
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  );
}
